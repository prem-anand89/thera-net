import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const randomStr = () => Math.random().toString(36).substring(7);

function e2eUrl() {
  return process.env.VITE_SUPABASE_URL;
}

function e2eKey() {
  return process.env.VITE_SUPABASE_ANON_KEY;
}

test.describe('RLS Boundaries', () => {
  const url = e2eUrl();
  const anonKey = e2eKey();

  test.skip(!url || !anonKey, 'needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');

  test('User in Clinic A cannot read Clinic B patients, and cross-clinic appointment linking fails via RPC', async () => {
    // 1. Create User A & Clinic A
    const clientA = createClient(url!, anonKey!);
    const emailA = `test-a-${randomStr()}@example.com`;
    await clientA.auth.signUp({ email: emailA, password: 'password123' });
    const { data: clinicIdA, error: errClinicA } = await clientA.rpc('create_clinic_with_admin', { p_name: 'Clinic A' });
    expect(errClinicA).toBeNull();
    expect(clinicIdA).toBeTruthy();

    // Create a patient in Clinic A
    const { data: patientA, error: errPatA } = await clientA.from('patients').insert({
      clinic_id: clinicIdA,
      name: 'Patient A',
      phone: '1234567890'
    }).select('id').single();
    expect(errPatA).toBeNull();

    // 2. Create User B & Clinic B
    const clientB = createClient(url!, anonKey!);
    const emailB = `test-b-${randomStr()}@example.com`;
    await clientB.auth.signUp({ email: emailB, password: 'password123' });
    const { data: clinicIdB, error: errClinicB } = await clientB.rpc('create_clinic_with_admin', { p_name: 'Clinic B' });
    expect(errClinicB).toBeNull();
    expect(clinicIdB).toBeTruthy();

    // Create an appointment in Clinic B
    const { data: appointmentB, error: errApptB } = await clientB.rpc('create_appointment_staff', {
      p_clinic_id: clinicIdB,
      p_name: 'Walk-in B',
      p_phone: '0987654321',
      p_therapist_id: null,
      p_scheduled_at: new Date().toISOString()
    });
    expect(errApptB).toBeNull();
    expect(appointmentB).toBeTruthy();
    
    // Create a visit in Clinic B
    const { data: visitB, error: errVisitB } = await clientB.from('visits').insert({
      clinic_id: clinicIdB,
      patient_name: 'Walk-in B',
      visit_date: new Date().toISOString().split('T')[0],
      bill_paise: 50000
    }).select('id').single();
    expect(errVisitB).toBeNull();

    // Assert User A cannot see Patient A via User B's client
    // Actually, User A can't see Clinic B's patients, so using clientA, search for clinicIdB patients
    const { data: visiblePatients, error: readError } = await clientA.from('patients').select('id').eq('clinic_id', clinicIdB);
    expect(readError).toBeNull();
    expect(visiblePatients).toHaveLength(0); // RLS blocks read

    // Cross-clinic appointment linking fails
    // clientB tries to link appointmentB (Clinic B) with patientA (Clinic A)
    const { error: rpcError } = await clientB.rpc('link_appointment_visit', {
      p_appointment_id: appointmentB,
      p_visit_id: visitB!.id,
      p_patient_id: patientA!.id
    });
    
    // Should fail because patientA does not belong to Clinic B
    expect(rpcError).toBeDefined();
    expect(rpcError!.message).toContain('Patient not found in this clinic');
  });
});
