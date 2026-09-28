import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function main() {
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'frontdesk@anandclinic.in',
    password: 'password123'
  });
  if (authErr) {
    console.error('Auth error:', authErr);
    return;
  }
  
  console.log('Logged in as', auth.user.email);
  
  // Find a clinic
  const { data: clinic, error: clinicErr } = await supabase.from('clinics').select('id, name').limit(1).single();
  if (clinicErr) {
    console.error('Clinic fetch error:', clinicErr);
    return;
  }
  
  console.log('Clinic:', clinic);
  
  // Find a visit
  const { data: visit, error: visitErr } = await supabase.from('visits').select('id').eq('clinic_id', clinic.id).limit(1).single();
  
  if (visit) {
    console.log('Trying to create feedback request for visit', visit.id);
    const { data: fb, error: fbErr } = await supabase.rpc('create_feedback_request', { p_visit_id: visit.id });
    console.log('Feedback request result:', { fb, fbErr });
  } else {
    console.log('No visit found, skipped feedback request test');
  }
  
  console.log('Trying to submit appointment request for slug', clinic.name);
  // test submit appointment request (which is anonymous, so we could even sign out)
  const { data: ar, error: arErr } = await supabase.rpc('submit_appointment_request', {
    p_slug: 'the-anand-clinic', // Assuming the slug is 'the-anand-clinic'
    p_name: 'Test Name',
    p_phone: '9876543210',
    p_email: null,
    p_preferred_therapist_id: null,
    p_notes: null,
    p_preferred_date: null,
    p_preferred_time_text: null
  });
  console.log('Booking request result:', { ar, arErr });
}

main().catch(console.error);
