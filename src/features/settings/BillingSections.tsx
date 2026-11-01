import { useEffect, useState } from 'react';
import { visitService } from '@/services';
import { getSupabase, publicLogoUrl } from '@/lib/supabase';
import { MONTH_NAMES } from '@/domain/fiscalYear';
import { clinicShareLabels, type Clinic, type InvoicePolicy } from '@/domain/types';
import type { TdsBasis } from '@/domain/split';
import { btnSecondary, ErrorNote, Field, inputCls, SectionCard, InfoTip } from '@/components/ui';
import { PLAN_TIER_LABELS, minimumTierFor } from '@/domain/plans';
import { toFriendlyMessage } from '@/lib/errors';
import { useClinicSectionForm, SectionSaveBar, SetOnceEditButton, BoolToggle } from './settingsShared';

type BillingFields = Pick<
  Clinic,
  | 'invoicePrefix'
  | 'gstNo'
  | 'fyStartMonth'
  | 'invoicingAccess'
  | 'invoicePolicy'
>;

export function BillingSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { form, set, save, cancel, dirty, saved, busy, error } =
    useClinicSectionForm<BillingFields>(
      (c) => ({
        invoicePrefix: c.invoicePrefix,
        gstNo: c.gstNo,
        fyStartMonth: c.fyStartMonth,
        invoicingAccess: c.invoicingAccess ?? 'everyone',
        invoicePolicy: c.invoicePolicy ?? 'on_request',
      }),
      onDirtyChange
    );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  async function saveBilling() {
    await save();
  }

  return (
    <SectionCard
      id="settings-card-billing-invoicing"
      title="Billing & invoicing"
      action={editing ? undefined : <SetOnceEditButton label="Edit billing & invoicing" onClick={() => setEditing(true)} />}
    >
      <fieldset disabled={!editing} className="contents">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Invoice prefix">
          <input
            className={inputCls}
            value={form.invoicePrefix}
            onChange={(e) => set({ invoicePrefix: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field
          label={
            <>
              GST / Tax ID (optional)
              <InfoTip text="Your clinic's tax registration number, printed on invoices. Not the same as the Tax/TDS % under Partner & split, which is a revenue-share percentage." />
            </>
          }
        >
          <input
            className={inputCls}
            value={form.gstNo ?? ''}
            onChange={(e) => set({ gstNo: e.target.value || null })}
          />
        </Field>
        <Field label="Fiscal year starts in month">
          <select
            className={inputCls}
            value={form.fyStartMonth}
            onChange={(e) => set({ fyStartMonth: Number(e.target.value) })}
          >
            {MONTH_NAMES.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field
            label={
              <>
                Who can issue invoices
                <InfoTip text="Everyone: any team member can bill a visit. Front desk and admins only: therapists log visits and clinical notes; billing happens separately." />
              </>
            }
          >
            <select
              className={inputCls}
              value={form.invoicingAccess}
              onChange={(e) =>
                set({ invoicingAccess: e.target.value as 'everyone' | 'billing_staff' })
              }
            >
              <option value="everyone">Everyone</option>
              <option value="billing_staff">Front desk and admins only</option>
            </select>
          </Field>
        <Field
            label={
              <>
                Bills after a visit
                <InfoTip text="Payments are always recorded. A bill (invoice) is a separate numbered document that can't be edited once given — so it's your call when to offer it." />
              </>
            }
          >
            <select
              className={inputCls}
              value={form.invoicePolicy ?? 'on_request'}
              onChange={(e) => set({ invoicePolicy: e.target.value as InvoicePolicy })}
            >
              <option value="on_request">On request — a "Give bill" button after each visit</option>
              <option value="always">Always — open the bill step after a paid visit</option>
              <option value="never_nag">Never remind — hide the Needs receipt list</option>
            </select>
          </Field>
      </div>

      </fieldset>
      {editing && (
        <p className="mt-3 rounded-lg bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--ink)]">
          The invoice prefix, fiscal year and tax apply to invoices issued from now on. Invoices already issued keep their numbers and rates.
        </p>
      )}
      {editing && (
      <SectionSaveBar
        dirty={dirty}
        saved={saved}
        busy={busy}
        onSave={() => void saveBilling()}
        onCancel={() => {
          cancel();
          setEditing(false);
        }}
        error={error}
      />
      )}
    </SectionCard>
  );
}

type PartnerFields = Pick<
  Clinic,
  | 'hasPartner'
  | 'partnerHospitalName'
  | 'partnerHospitalLogoPath'
  | 'partnerCollects'
  | 'enableTherapistSplit'
  | 'ownShareLabel'
  | 'partnerShareLabel'
  | 'clinicSplitPct'
  | 'taxPct'
  | 'tdsBasis'
  | 'lastSplitChangeAt'
>;

/** True when a saved change to these fields moves the split of visits not yet invoiced. */
export function partnerSplitChanged(
  before: Pick<Clinic, 'hasPartner' | 'clinicSplitPct' | 'taxPct' | 'tdsBasis'>,
  after: Pick<Clinic, 'hasPartner' | 'clinicSplitPct' | 'taxPct' | 'tdsBasis'>
): boolean {
  return (
    Boolean(before.hasPartner) !== Boolean(after.hasPartner) ||
    before.clinicSplitPct !== after.clinicSplitPct ||
    before.taxPct !== after.taxPct ||
    before.tdsBasis !== after.tdsBasis
  );
}

/**
 * Billing → "Partner & split": every partner setting in one card — whether the clinic works with a partner (a hospital
 * or a centre it shares revenue with), the partner's name and logo, who collects patient payments, the share labels,
 * the split %, tax % and TDS basis. These all feed clinicBillingConfig() / computeVisitSplit(), so they save together.
 *
 * Shown on every plan so search always lands somewhere: below the plan that includes `revenueSplit` the switch is
 * disabled with the plan that has it; a clinic that still has partner mode on after moving to such a plan can only
 * turn it off. Changing partner mode, the split, the tax % or the TDS basis re-applies the split to visits not yet
 * invoiced (invoiced visits keep the rates they were billed under).
 */
export function PartnerSection({ onDirtyChange, allowed }: { onDirtyChange: (dirty: boolean) => void; allowed: boolean }) {
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError } =
    useClinicSectionForm<PartnerFields>(
      (c) => ({
        hasPartner: c.hasPartner ?? false,
        partnerHospitalName: c.partnerHospitalName ?? null,
        partnerHospitalLogoPath: c.partnerHospitalLogoPath ?? null,
        partnerCollects: c.partnerCollects ?? false,
        enableTherapistSplit: c.enableTherapistSplit,
        ownShareLabel: c.ownShareLabel,
        partnerShareLabel: c.partnerShareLabel,
        clinicSplitPct: c.clinicSplitPct,
        taxPct: c.taxPct,
        tdsBasis: c.tdsBasis,
      }),
      onDirtyChange
    );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  const labels = clinicShareLabels(form);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  const partnerLogoUrl = publicLogoUrl(form.partnerHospitalLogoPath);
  const planName = PLAN_TIER_LABELS[minimumTierFor('revenueSplit')];

  /** Re-applies the split to visits not yet invoiced, and stamps the change for Workspace's "your split changed" note. */
  async function recomputeSplits() {
    await saveFieldNow({ lastSplitChangeAt: new Date().toISOString() });
    try {
      const { updated } = await visitService.recomputeUninvoicedSplits(clinic.id);
      setRecomputeMsg(
        updated > 0
          ? `Applied the new split to ${updated} already-logged, not-yet-invoiced visit${updated === 1 ? '' : 's'}.`
          : 'No not-yet-invoiced visits needed updating.'
      );
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function savePartner() {
    setRecomputeMsg(null);
    const splitAffected = partnerSplitChanged(clinic, form);
    const ok = await save();
    if (ok && splitAffected) await recomputeSplits();
  }

  const [turningOff, setTurningOff] = useState(false);
  async function turnOffPartnerMode() {
    setRecomputeMsg(null);
    setError(null);
    setTurningOff(true);
    try {
      await saveFieldNow({ hasPartner: false, partnerCollects: false });
      await recomputeSplits();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setTurningOff(false);
    }
  }

  async function uploadPartnerLogo(file: File) {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Logo upload needs a connection.');
      return;
    }
    const path = `${clinic.id}/partner-logo-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage.from('clinic-assets').upload(path, file);
    if (uploadError) {
      setError(`Upload failed: ${toFriendlyMessage(uploadError)}`);
      return;
    }
    await saveFieldNow({ partnerHospitalLogoPath: path } as Partial<PartnerFields>);
  }

  // Below the plan that includes the partner split: nothing to edit, only a way out for a clinic that still has it on.
  if (!allowed) {
    return (
      <SectionCard id="settings-card-billing-partner" title="Partner & split">
        {clinic.hasPartner ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--ink)]">
              Partner settings need the {planName} plan. Partner mode is still on for this clinic
              {clinic.partnerHospitalName ? ` (${clinic.partnerHospitalName})` : ''}.
            </p>
            <p className="text-hint text-[var(--muted)]">
              Turning it off re-applies the split to visits not yet invoiced. Visits already marked “Collected by partner”
              keep that.
            </p>
            <button type="button" className={btnSecondary} disabled={turningOff} onClick={() => void turnOffPartnerMode()}>
              {turningOff ? 'Turning off…' : 'Turn off partner mode'}
            </button>
            {recomputeMsg && <p className="text-xs text-[var(--moss)]">{recomputeMsg}</p>}
            <ErrorNote message={error} />
          </div>
        ) : (
          <div className="flex min-h-11 items-center justify-between gap-3 opacity-70">
            <span>
              <span className="block text-sm font-medium text-[var(--ink)]">We work with a partner</span>
              <span className="block text-hint text-[var(--muted)]">
                Share revenue with a hospital or centre. Available on the {planName} plan.
              </span>
            </span>
            <input type="checkbox" role="switch" aria-label="We work with a partner" className="h-5 w-5 shrink-0" checked={false} disabled readOnly />
          </div>
        )}
      </SectionCard>
    );
  }

  return (
    <SectionCard
      id="settings-card-billing-partner"
      title="Partner & split"
      action={editing ? undefined : <SetOnceEditButton label="Edit partner & split" onClick={() => setEditing(true)} />}
    >
      <fieldset disabled={!editing} className="contents">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-medium text-[var(--ink)]">We work with a partner</span>
            <span className="block text-hint text-[var(--muted)]">A hospital or centre you share each visit&apos;s revenue with.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="We work with a partner"
            className="h-5 w-5 shrink-0 accent-[var(--teal)]"
            checked={Boolean(form.hasPartner)}
            onChange={(e) => set({ hasPartner: e.target.checked })}
          />
        </label>

        {form.hasPartner && (
          <div className="mt-4 grid grid-cols-1 gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
            <div className="flex items-start gap-3 sm:col-span-2">
              <div className="flex shrink-0 flex-col items-center gap-2">
                {partnerLogoUrl ? (
                  <img src={partnerLogoUrl} alt="Partner logo" className="h-14 w-14 rounded border border-[var(--border)] bg-white object-contain p-1" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded border border-[var(--border)] bg-[var(--paper)] text-caption text-[var(--muted)]">
                    No logo
                  </div>
                )}
                <label className="cursor-pointer text-xs font-semibold text-[var(--teal)] hover:underline">
                  Upload logo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && void uploadPartnerLogo(e.target.files[0])}
                  />
                </label>
              </div>
              <div className="min-w-0 flex-1">
                <Field label="Partner name" htmlFor="partner-name">
                  <input
                    id="partner-name"
                    className={inputCls}
                    placeholder="e.g. City Hospital"
                    value={form.partnerHospitalName ?? ''}
                    onChange={(e) => set({ partnerHospitalName: e.target.value || null })}
                  />
                </Field>
              </div>
            </div>

            <div className="sm:col-span-2">
              <Field
                label={
                  <>
                    Who collects patient payments?
                    <InfoTip text="We do: patients pay the clinic and you settle the partner's share. The partner does: patients pay at the partner's counter and the partner settles with you. Either way you can change it on a single visit." />
                  </>
                }
              >
                <BoolToggle
                  value={Boolean(form.partnerCollects)}
                  onChange={(v) => set({ partnerCollects: v })}
                  offLabel="We do"
                  onLabel={`${form.partnerHospitalName?.trim() || 'The partner'} does`}
                />
              </Field>
            </div>

            <Field label="Your share label (report column, e.g. Clinic)">
              <input
                className={inputCls}
                placeholder="Clinic"
                value={form.ownShareLabel ?? ''}
                onChange={(e) => set({ ownShareLabel: e.target.value || null })}
              />
            </Field>
            <Field label="Partner share label (report column, e.g. Hospital)">
              <input
                className={inputCls}
                placeholder="Hospital"
                value={form.partnerShareLabel ?? ''}
                onChange={(e) => set({ partnerShareLabel: e.target.value || null })}
              />
            </Field>
            <Field label={`Your share % (${labels.own} split)`}>
              <input
                type="number"
                className={inputCls}
                value={form.clinicSplitPct}
                onChange={(e) => set({ clinicSplitPct: Number(e.target.value) })}
              />
            </Field>
            <Field
              label={
                <>
                  Tax / TDS % (optional)
                  <InfoTip text="Tax Deducted at Source — the % withheld from payouts. Leave blank if not applicable. When enabled with a partner, TDS is calculated based on the TDS basis below." />
                </>
              }
            >
              <input
                type="number"
                className={inputCls}
                placeholder="0"
                value={form.taxPct ?? ''}
                onChange={(e) => set({ taxPct: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
            </Field>
            {form.taxPct > 0 && (
              <Field
                label={
                  <>
                    TDS basis
                    <InfoTip text="Whether the tax % is calculated on the full bill (standard format) or only on the clinic's own share. Both produce the same final clinic payout." />
                  </>
                }
              >
                <select className={inputCls} value={form.tdsBasis} onChange={(e) => set({ tdsBasis: e.target.value as TdsBasis })}>
                  <option value="gross_bill">
                    {form.taxPct}% of gross bill (matches {labels.partner} sheet)
                  </option>
                  <option value="clinic_share">On clinic share only</option>
                </select>
              </Field>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--muted)]">
          Turning partner mode on or off, or changing the split or tax, applies going forward and, on Save, also to any
          already-logged visit that hasn&apos;t been invoiced yet. Invoiced visits keep the rates they were billed under.
        </p>
        {recomputeMsg && <p className="mt-1 text-xs text-[var(--moss)]">{recomputeMsg}</p>}
      </fieldset>
      {editing && (
        <SectionSaveBar
          dirty={dirty}
          saved={saved}
          busy={busy}
          onSave={() => void savePartner()}
          onCancel={() => {
            cancel();
            setEditing(false);
          }}
          error={error}
        />
      )}
    </SectionCard>
  );
}
