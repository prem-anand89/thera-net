import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }));
vi.mock('@/sync/engine', () => ({ syncEngine: { schedule: vi.fn() } }));
vi.mock('@/sync/pendingLinks', () => ({ enqueueAppointmentLink: vi.fn() }));
vi.mock('@/lib/pdfShare', () => ({ openPatientWhatsAppChat: vi.fn() }));

import { locationArg } from './bookingService';

describe('locationArg', () => {
  it('sends nothing for a clinic booking, so existing clinics send exactly what they sent before', () => {
    expect(locationArg(undefined)).toEqual({});
    expect(locationArg('clinic')).toEqual({});
  });
  it('sends the location for anything else', () => {
    expect(locationArg('home')).toEqual({ p_location: 'home' });
    expect(locationArg('ward')).toEqual({ p_location: 'ward' });
  });
});
