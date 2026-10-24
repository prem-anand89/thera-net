import { useEffect, useState } from 'react';
import { visitService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { getSupabase, publicLogoUrl } from '@/lib/supabase';
import { MONTH_NAMES } from '@/domain/fiscalYear';
import { clinicShareLabels, type Clinic, type InvoicePolicy } from '@/domain/types';
import type { TdsBasis } from '@/domain/split';
import { Field, inputCls, SectionCard, InfoTip } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { isValidUpiVpa } from '@/domain/upiPay';
import { useClinicSectionForm, SectionSaveBar, SetOnceEditButton, BoolToggle } from './settingsShared';

type BillingFields = Pick<
  Clinic,
  | 'invoicePrefix'
  | 'gstNo'
  | 'fyStartMonth'
  | 'invoicingAccess'
  | 'invoicePolicy'
  | 'upiVpa'
  | 'upiPayeeName'
  | 'upiQrPath'
  | 'upiQrEnabled'
>;

export function BillingSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError } =
    useClinicSectionForm<BillingFields>(
      (c) => ({
        invoicePrefix: c.invoicePrefix,
        gstNo: c.gstNo,
        fyStartMonth: c.fyStartMonth,
        invoicingAccess: c.invoicingAccess ?? 'everyone',
        invoicePolicy: c.invoicePolicy ?? 'on_request',
        upiVpa: c.upiVpa ?? '',
        upiPayeeName: c.upiPayeeName ?? '',
        upiQrPath: c.upiQrPath ?? null,
        upiQrEnabled: c.upiQrEnabled ?? false,
      }),
      onDirtyChange
    );
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing && saved && !dirty) setEditing(false);
  }, [editing, saved, dirty]);
  const qrPreviewUrl = publicLogoUrl(form.upiQrPath);

  async function uploadUpiQr(file: File) {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('QR upload needs a connection.');
      return;
    }
    const path = `${clinic.id}/upi-qr-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage.from('clinic-assets').upload(path, file);
    if (uploadError) {
      setError(`Upload failed: ${toFriendlyMessage(uploadError)}`);
      return;
    }
    await saveFieldNow({ upiQrPath: path } as Partial<BillingFields>);
  }



  async function saveBilling() {
    const vpa = (form.upiVpa ?? '').trim();
    if (form.upiQrEnabled && vpa && !isValidUpiVpa(vpa)) {
      setError('Enter a valid UPI ID (e.g. clinic@okaxis) or turn UPI QR off.');
      return;
    }
    if (form.upiQrEnabled && !vpa && !form.upiQrPath) {
      setError('Add a UPI ID or upload a QR image before turning UPI QR on.');
      return;
    }
    await save();
  }

  return (
    <SectionCard
      id="settings-card-billing-invoicing"
      title="Modules & invoicing"
      action={editing ? undefined : <SetOnceEditButton label="Edit modules & invoicing" onClick={() => setEditing(true)} />}
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

      <h3 className="font-display mt-6 mb-3 text-sm font-semibold text-[var(--ink)]">
        UPI collection
      </h3>
      <p className="mb-3 text-xs text-[var(--muted)]">
        One clinic UPI for the front desk. When collection method is UPI, staff can show a QR the
        patient scans. A UPI ID builds a QR with the visit amount and Patient ID in the note; an
        uploaded image is the fallback.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label={
            <>
              Show UPI QR at collection
              <InfoTip text="When on, New visit and Take payment show a Scan to pay sheet if the method is UPI." />
            </>
          }
        >
          <BoolToggle
            value={form.upiQrEnabled ?? false}
            onChange={(v) => set({ upiQrEnabled: v })}
          />
        </Field>
        {form.upiQrEnabled && (
          <>
            <Field label="UPI ID (VPA)">
              <input
                className={inputCls}
                placeholder="clinic@okaxis"
                value={form.upiVpa ?? ''}
                onChange={(e) => set({ upiVpa: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field
              label={
                <>
                  Payee name
                  <InfoTip text="Shown in the patient's UPI app. Leave blank to use the clinic name." />
                </>
              }
            >
              <input
                className={inputCls}
                placeholder={clinic.name}
                value={form.upiPayeeName ?? ''}
                onChange={(e) => set({ upiPayeeName: e.target.value })}
              />
            </Field>
            <Field label="QR image (optional)">
              <input
                type="file"
                accept="image/*"
                className={inputCls}
                onChange={(e) => e.target.files?.[0] && void uploadUpiQr(e.target.files[0])}
              />
              {qrPreviewUrl && (
                <img
                  src={qrPreviewUrl}
                  alt="Uploaded clinic UPI QR"
                  className="mt-2 h-24 w-24 object-contain"
                />
              )}
            </Field>
          </>
        )}
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
  | 'enableTherapistSplit'
  | 'ownShareLabel'
  | 'partnerShareLabel'
  | 'clinicSplitPct'
  | 'taxPct'
  | 'tdsBasis'
  | 'lastSplitChangeAt'
>;

// These fields are read together by clinicBillingConfig() to determine
// partnerSplit/therapistSplit — kept in one section/save so they can never
// go out of sync with each other mid-edit.
export function PartnerSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const clinic_ctx = useClinic();
  const { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError } =
    useClinicSectionForm<PartnerFields>(
      (c) => ({
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

  if (!clinic_ctx.hasPartner) return null;

  // hasPartner/clinicSplitPct/taxPct/tdsBasis all feed clinicBillingConfig() and
  // computeVisitSplit() — a change to any of them means visits already
  // logged (but not yet invoiced) are now showing a stale split, since
  // updateBilling deliberately keeps a visit's ORIGINAL rate snapshot on
  // edit. Catch those up here, right where the rate actually changed,
  // instead of leaving it to silently only affect visits logged from now on.
  async function savePartner() {
    setRecomputeMsg(null);
    const splitAffected =
      form.clinicSplitPct !== clinic.clinicSplitPct ||
      form.taxPct !== clinic.taxPct ||
      form.tdsBasis !== clinic.tdsBasis;
    const ok = await save();
    if (ok && splitAffected) {
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
  }



  return (
    <SectionCard
      id="settings-card-billing-partner"
      title="Partner & split"
      action={editing ? undefined : <SetOnceEditButton label="Edit partner & split" onClick={() => setEditing(true)} />}
    >
      <fieldset disabled={!editing} className="contents">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <select
              className={inputCls}
              value={form.tdsBasis}
              onChange={(e) => set({ tdsBasis: e.target.value as TdsBasis })}
            >
              <option value="gross_bill">
                {form.taxPct}% of gross bill (matches {labels.partner} sheet)
              </option>
              <option value="clinic_share">On clinic share only</option>
            </select>
          </Field>
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Split/tax changes apply going forward automatically, and — on Save — also to any
        already-logged visit that hasn't been invoiced yet. Invoiced visits keep the rates they were
        billed under.
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
