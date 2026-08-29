import { inputCls, Field } from '@/components/ui';

export interface ClinicalFields {
  diagnosis: string;
  referringPhysician: string;
  physicianRegistrationNo: string;
  placeOfService: 'clinic' | 'home';
  treatmentPerformed: string;
}

export const EMPTY_CLINICAL_FIELDS: ClinicalFields = {
  diagnosis: '',
  referringPhysician: '',
  physicianRegistrationNo: '',
  placeOfService: 'clinic',
  treatmentPerformed: '',
};

/**
 * The diagnosis/referring-physician/place-of-service/treatment-performed
 * form, shared by `IssueInvoiceDialog` (pre-filled from the patient's note,
 * frozen into `clinical_snapshot` at issue time) and `EditInvoiceDetailsDialog`
 * (pre-filled from the invoice's existing snapshot, correctable afterward).
 * Purely presentational — callers own the field state and any pre-fill
 * source.
 */
export function InvoiceClinicalFieldsForm({
  fields,
  onChange,
  hints,
}: {
  fields: ClinicalFields;
  onChange: <K extends keyof ClinicalFields>(key: K, value: ClinicalFields[K]) => void;
  /** Per-field "From patient's note — edit if needed" hints — only
   *  meaningful at issue time, when a note actually supplied the pre-fill. */
  hints?: Partial<Record<keyof ClinicalFields, string>>;
}) {
  return (
    <div className="space-y-3">
      <Field label="Diagnosis" hint={hints?.diagnosis}>
        <input
          className={inputCls}
          value={fields.diagnosis}
          onChange={(e) => onChange('diagnosis', e.target.value)}
          placeholder="e.g. Lumbar disc prolapse L4-L5"
        />
      </Field>
      <Field label="Referring physician" hint={hints?.referringPhysician}>
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={fields.referringPhysician}
            onChange={(e) => onChange('referringPhysician', e.target.value)}
            placeholder="Physician name"
          />
          <input
            className={inputCls}
            value={fields.physicianRegistrationNo}
            onChange={(e) => onChange('physicianRegistrationNo', e.target.value)}
            placeholder="Reg. No."
          />
        </div>
      </Field>
      <Field label="Place of service">
        <select
          className={inputCls}
          value={fields.placeOfService}
          onChange={(e) => onChange('placeOfService', e.target.value as 'clinic' | 'home')}
        >
          <option value="clinic">Clinic (OP visit)</option>
          <option value="home">Home (domiciliary)</option>
        </select>
      </Field>
      <Field label="Treatment performed" hint={hints?.treatmentPerformed}>
        <input
          className={inputCls}
          value={fields.treatmentPerformed}
          onChange={(e) => onChange('treatmentPerformed', e.target.value)}
          placeholder="e.g. Manual therapy, therapeutic exercise"
        />
      </Field>
    </div>
  );
}
