import { useState } from 'react';
import { visitService } from '@/services';
import { getSupabase, publicLogoUrl } from '@/lib/supabase';
import { clinicShareLabels, type Clinic } from '@/domain/types';
import type { TdsBasis } from '@/domain/split';
import { btnSecondary, ConfirmDialog, ErrorNote, Field, inputCls, SectionCard, InfoTip } from '@/components/ui';
import { PLAN_TIER_LABELS, minimumTierFor } from '@/domain/plans';
import { clinicDepartments, effectiveIpInvoicePrefix } from '@/domain/departments';
import { fiscalYearOf } from '@/domain/fiscalYear';
import { toFriendlyMessage } from '@/lib/errors';
import { useClinicSectionForm, SectionSaveBar, SwitchRow } from './settingsShared';

type BillingFields = Pick<
  Clinic,
  | 'gstNo'
  | 'invoicingAccess'
  | 'ipInvoicePrefix'
>;

export function BillingSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, dirty, saved, busy, error, showSaveBar } =
    useClinicSectionForm<BillingFields>(
      (c) => ({
        gstNo: c.gstNo,
        invoicingAccess: c.invoicingAccess ?? 'everyone',
        ipInvoicePrefix: c.ipInvoicePrefix ?? null,
      }),
      onDirtyChange
    );

  const hasIp = clinicDepartments(clinic).includes('ward');
  const prefix = clinic.invoicePrefix ?? '';
  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);

  const rawIpPrefix = form.ipInvoicePrefix ?? '';
  const trimmedIpPrefix = rawIpPrefix.trim().toUpperCase();
  let ipPrefixError: string | null = null;
  if (hasIp && trimmedIpPrefix !== '') {
    if (!/^[A-Z0-9]{2,10}$/.test(trimmedIpPrefix)) {
      ipPrefixError = 'Use 2–10 letters or digits (no spaces or slashes)';
    } else if (trimmedIpPrefix === prefix.trim().toUpperCase()) {
      ipPrefixError = 'IP invoice prefix must differ from the main invoice prefix';
    }
  }

  async function saveBilling() {
    if (ipPrefixError) return;
    await save();
  }

  return (
    <SectionCard
      id="settings-card-billing-invoicing"
      title="Invoicing"
    >
      <fieldset disabled={busy} className="contents">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label={
            <>
              GST number (optional)
              <InfoTip text="Your clinic's tax registration number, printed on invoices. Not the same as the Tax/TDS % under Partner revenue share, which is a revenue-share percentage." />
            </>
          }
        >
          <input
            className={inputCls}
            value={form.gstNo ?? ''}
            onChange={(e) => set({ gstNo: e.target.value || null })}
          />
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
        {hasIp && (
          <Field
            label="IP invoice prefix (optional)"
            hint={`Sample IP invoice number: ${effectiveIpInvoicePrefix({ invoicePrefix: prefix, ipInvoicePrefix: trimmedIpPrefix })}/${currentFy.label}/0001. Leave blank to use ${prefix}IP.`}
          >
            <input
              className={inputCls}
              maxLength={10}
              placeholder={`${prefix}IP`}
              value={form.ipInvoicePrefix ?? ''}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                set({ ipInvoicePrefix: val === '' ? null : val });
              }}
            />
            {ipPrefixError && (
              <p role="alert" className="mt-1 text-hint text-[var(--rust)]">
                {ipPrefixError}
              </p>
            )}
          </Field>
        )}
      </div>

      </fieldset>
      {dirty && (
        <p className="mt-3 rounded-lg bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--ink)]">
          The GST number applies to invoices issued from now on. Invoices already issued keep their numbers and rates.
        </p>
      )}
      {showSaveBar && (
      <SectionSaveBar
        dirty={dirty}
        saved={saved}
        busy={busy}
        onSave={() => void saveBilling()}
        saveDisabled={Boolean(ipPrefixError)}
        onCancel={() => {
          cancel();
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
 * Payments & billing → "Partner revenue share": every partner setting in one card — whether the clinic works with a partner (a hospital
 * or a centre it shares revenue with), the partner's name and logo, who collects patient payments, the share labels,
 * the split %, tax % and TDS basis. These all feed clinicBillingConfig() / computeVisitSplit(), so they save together.
 *
 * Shown on every plan so search always lands somewhere: below the plan that includes `revenueSplit` the switch is
 * disabled with the plan that has it; a clinic that still has partner mode on after moving to such a plan can only
 * turn it off. Changing partner mode, the split, the tax % or the TDS basis re-applies the split to visits not yet
 * invoiced (invoiced visits keep the rates they were billed under).
 */
export function PartnerSection({ onDirtyChange, allowed }: { onDirtyChange: (dirty: boolean) => void; allowed: boolean }) {
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError, showSaveBar } =
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
  const labels = clinicShareLabels(form);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  // Report column names and the TDS basis are rarely changed: tucked under "More options" unless already customised.
  const [moreOpenByHand, setMoreOpen] = useState(false);
  const moreOpen = moreOpenByHand || Boolean(form.ownShareLabel || form.partnerShareLabel || form.tdsBasis === 'clinic_share');
  const partnerLogoUrl = publicLogoUrl(form.partnerHospitalLogoPath);
  const planName = PLAN_TIER_LABELS[minimumTierFor('revenueSplit')];

  // Changing partner mode, the split, tax % or TDS basis rewrites visits not yet invoiced, so it asks first, saying how
  // many. `pendingSplitSave` holds what to run once confirmed and the count shown.
  const [pendingSplitSave, setPendingSplitSave] = useState<{ count: number; run: () => Promise<void> } | null>(null);
  const [recomputeFailed, setRecomputeFailed] = useState(false);

  /** Re-applies the split to visits not yet invoiced, and stamps the change for Workspace's "your split changed" note. */
  async function recomputeSplits() {
    setRecomputeFailed(false);
    try {
      await saveFieldNow({ lastSplitChangeAt: new Date().toISOString() });
      const { updated } = await visitService.recomputeUninvoicedSplits(clinic.id);
      setRecomputeMsg(
        updated > 0
          ? `Applied the new split to ${updated} already-logged, not-yet-invoiced visit${updated === 1 ? '' : 's'}.`
          : 'No not-yet-invoiced visits needed updating.'
      );
    } catch (e) {
      setRecomputeFailed(true);
      setError(`Settings saved, but visits not yet invoiced were not updated: ${toFriendlyMessage(e)}`);
    }
  }

  /** Runs `run` straight away when it changes no visit; otherwise asks first with the number of visits it changes. */
  async function confirmIfVisitsChange(settings: PartnerFields, run: () => Promise<void>) {
    setRecomputeMsg(null);
    setError(null);
    let count = 0;
    try {
      count = await visitService.countUninvoicedSplitChanges(clinic.id, {
        hasPartner: settings.hasPartner,
        clinicSplitPct: settings.clinicSplitPct,
        taxPct: settings.taxPct,
        tdsBasis: settings.tdsBasis,
      });
    } catch (e) {
      setError(toFriendlyMessage(e));
      return;
    }
    if (count === 0) await run();
    else setPendingSplitSave({ count, run });
  }

  async function savePartner() {
    const splitAffected = partnerSplitChanged(clinic, form);
    const ok = await save();
    if (ok && splitAffected) await recomputeSplits();
  }

  function onSavePartner() {
    if (!partnerSplitChanged(clinic, form)) {
      setRecomputeMsg(null);
      void save();
      return;
    }
    void confirmIfVisitsChange(form, savePartner);
  }

  const [turningOff, setTurningOff] = useState(false);
  async function turnOffPartnerMode() {
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

  const splitConfirm = (
    <ConfirmDialog
      open={pendingSplitSave !== null}
      title="Update visits not yet invoiced?"
      message={
        pendingSplitSave
          ? `This recalculates ${pendingSplitSave.count} visit${pendingSplitSave.count === 1 ? '' : 's'} that ${pendingSplitSave.count === 1 ? 'has' : 'have'} no invoice yet. Invoices already issued stay as they are.`
          : ''
      }
      confirmLabel="Save and update"
      onCancel={() => setPendingSplitSave(null)}
      onConfirm={() => {
        const run = pendingSplitSave?.run;
        setPendingSplitSave(null);
        if (run) void run();
      }}
    />
  );

  const retryRecompute = recomputeFailed && (
    <button type="button" className={btnSecondary} onClick={() => { setError(null); void recomputeSplits(); }}>
      Update visits again
    </button>
  );

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
      <SectionCard id="settings-card-billing-partner" title="Partner revenue share">
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
            <button type="button" className={btnSecondary} disabled={turningOff} onClick={() => void confirmIfVisitsChange({ ...form, hasPartner: false }, turnOffPartnerMode)}>
              {turningOff ? 'Turning off…' : 'Turn off partner mode'}
            </button>
            {recomputeMsg && <p className="text-xs text-[var(--moss)]">{recomputeMsg}</p>}
            <ErrorNote message={error} />
            {retryRecompute}
          </div>
        ) : (
          <SwitchRow
            label="We work with a partner"
            hint={`Share revenue with a hospital or centre. Available on the ${planName} plan and above.`}
            checked={false}
            disabled
            onChange={() => {}}
          />
        )}
        {splitConfirm}
      </SectionCard>
    );
  }

  return (
    <SectionCard
      id="settings-card-billing-partner"
      title="Partner revenue share"
    >
      <fieldset disabled={busy} className="contents">
        <SwitchRow
          label="We work with a partner"
          hint="A hospital or centre you share each visit's revenue with."
          checked={Boolean(form.hasPartner)}
          onChange={(v) => set({ hasPartner: v })}
        />

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
              <SwitchRow
                label={`${form.partnerHospitalName?.trim() || 'The partner'} collects patient payments`}
                hint="Turn on if patients pay at the partner's counter. You can change it on a single visit."
                checked={Boolean(form.partnerCollects)}
                onChange={(v) => set({ partnerCollects: v })}
              />
            </div>

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
            <div className="sm:col-span-2">
              <button
                type="button"
                className="min-h-9 rounded-md px-2 text-xs font-semibold text-[var(--teal)] hover:bg-[var(--paper)]"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
              >
                {moreOpen ? 'Fewer options' : 'More options'}
              </button>
              <span className="block px-2 text-hint text-[var(--muted)]">Report column names{form.taxPct > 0 ? ' and how TDS is worked out' : ''}</span>
            </div>
            {moreOpen && (
              <>
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
                      {form.taxPct}% on the full bill (matches {labels.partner} sheet)
                    </option>
                    <option value="clinic_share">On your share only</option>
                  </select>
                </Field>
              )}
              </>
            )}
          </div>
        )}
        {recomputeMsg && <p className="mt-1 text-xs text-[var(--moss)]">{recomputeMsg}</p>}
        {retryRecompute && <div className="mt-2">{retryRecompute}</div>}
      </fieldset>
      {showSaveBar && (
        <SectionSaveBar
          dirty={dirty}
          saved={saved}
          busy={busy}
          onSave={onSavePartner}
          onCancel={() => {
            cancel();
          }}
          error={error}
        />
      )}
      {splitConfirm}
    </SectionCard>
  );
}
