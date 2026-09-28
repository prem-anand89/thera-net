import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://ajzcfbgjvnxgpebowwqc.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqemNmYmdqdm54Z3BlYm93d3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjY3MjksImV4cCI6MjEwNTg0MjcyOX0.wHG8SutXG10PKlAXDzYYD_SRgYCj86k_YIiga9xS8OU');

async function main() {
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'admin@anandclinic.in',
    password: 'password123'
  });
  if (authErr) {
    console.error('Auth error:', authErr);
    return;
  }
  
  console.log('Logged in as', auth.user.email);
  
  const { data: clinic, error: clinicErr } = await supabase.from('clinics').select('id, name, enable_patient_comms, booking_slug').limit(1).single();
  if (clinicErr) {
    console.error('Clinic fetch error:', clinicErr);
    return;
  }
  
  console.log('Clinic before:', clinic);
  
  const { data: updateData, error: updateErr } = await supabase.from('clinics').update({
    enable_patient_comms: true,
    booking_slug: 'the-anand-clinic'
  }).eq('id', clinic.id).select();
  
  if (updateErr) {
    console.error('Update error:', updateErr);
  } else {
    console.log('Clinic after:', updateData[0]);
  }
}

main().catch(console.error);
