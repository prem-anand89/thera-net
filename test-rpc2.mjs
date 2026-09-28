import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://ajzcfbgjvnxgpebowwqc.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqemNmYmdqdm54Z3BlYm93d3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjY3MjksImV4cCI6MjEwNTg0MjcyOX0.wHG8SutXG10PKlAXDzYYD_SRgYCj86k_YIiga9xS8OU');

async function main() {
  console.log('Trying to submit appointment request for slug the-anand-clinic');
  const { data: ar, error: arErr } = await supabase.rpc('submit_appointment_request', {
    p_slug: 'the-anand-clinic',
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
