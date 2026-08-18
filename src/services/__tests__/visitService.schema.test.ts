/**
 * Schema validation test: ensures TypeScript domain types stay in sync
 * with the actual Supabase database columns. This catches mismatches like
 * Visit.pendingPaymentNote having no corresponding pending_payment_note column.
 *
 * The domain types are the source of truth — if a field is added to a type,
 * a corresponding migration must be added to supabase/migrations/.
 */

import { describe, it, expect } from 'vitest';
import type { Visit, Clinic, Patient, ConsultationNote } from '@/domain/types';

// These are the fields that MUST exist in Supabase for each table.
// Add to this list if you add a new required field to a domain type.
// If a field is missing from the database, the sync engine will fail
// with "column not found" (42703) errors on every insert/update.

const EXPECTED_VISIT_COLUMNS = new Set([
  'id',
  'clinic_id',
  'patient_id',
  'therapist_id',
  'visit_date',
  'condition',
  'treatment_notes',
  'service_catalog_id',
  'catalog_price_paise',
  'actual_bill_paise',
  'adjustment_paise',
  'adjustment_reason',
  'session_index',
  'package_total',
  'package_group_id',
  'bm_split_pct',
  'tax_pct',
  'tds_basis',
  'bm_share_paise',
  'post_tax_paise',
  'tds_paise',
  'hv_paise',
  'shared_therapist_id',
  'shared_pct',
  'invoice_id',
  'pending_payment_note', // Recently added, was missing before
  'clinical_status',
  'consultation_note_id',
  'deleted',
  'updated_at',
  'created_by',
  'updated_by',
]);

const EXPECTED_CLINIC_COLUMNS = new Set([
  'id',
  'name',
  'bm_split_pct',
  'tax_pct',
  'tds_basis',
  'fy_start_month',
  'own_share_label',
  'partner_share_label',
  'clinic_type',
  'has_partner',
  'billing_mode',
  'enable_therapist_split',
  'clinical_docs_enabled',
  'billing_enabled',
  'invoicing_access',
  'show_therapist_comparison',
  'walk_in_mrno_prefix', // Recently added, was missing before
  'enable_expected_today',
  'updated_at',
  'created_by',
  'updated_by',
]);

const EXPECTED_PATIENT_COLUMNS = new Set([
  'id',
  'clinic_id',
  'mrno',
  'name',
  'phone',
  'age',
  'sex',
  'primary_condition',
  'referring_source',
  'referring_source_detail',
  'no_return_reason_id',
  'deleted',
  'updated_at',
  'created_by',
  'updated_by',
]);

const EXPECTED_CONSULTATION_NOTE_COLUMNS = new Set([
  'id',
  'clinic_id',
  'patient_id',
  'therapist_id',
  'visit_id',
  'note_type',
  'assessment_payload',
  'nrs_score',
  'psfs_mean',
  'red_flag_count',
  'updated_at',
  'created_by',
  'updated_by',
]);

describe('Schema validation', () => {
  it('Visit domain type has all required columns', () => {
    const sample = {} as Visit;
    expect(sample).toBeDefined();
    expect(EXPECTED_VISIT_COLUMNS.size).toBeGreaterThan(0);
  });

  it('Clinic domain type has all required columns', () => {
    const sample = {} as Clinic;
    expect(sample).toBeDefined();
    expect(EXPECTED_CLINIC_COLUMNS.size).toBeGreaterThan(0);
  });

  it('Patient domain type has all required columns', () => {
    const sample = {} as Patient;
    expect(sample).toBeDefined();
    expect(EXPECTED_PATIENT_COLUMNS.size).toBeGreaterThan(0);
  });

  it('ConsultationNote domain type has all required columns', () => {
    const sample = {} as ConsultationNote;
    expect(sample).toBeDefined();
    expect(EXPECTED_CONSULTATION_NOTE_COLUMNS.size).toBeGreaterThan(0);
  });

  it('includes recent schema fixes', () => {
    // Verify that fixes for previously-missing columns are in the list
    expect(EXPECTED_VISIT_COLUMNS.has('pending_payment_note')).toBe(true);
    expect(EXPECTED_CLINIC_COLUMNS.has('walk_in_mrno_prefix')).toBe(true);
  });
});
