import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { hasSupabaseConfig } from '@/lib/env';
import { bookingService } from '@/services';
import type { UUID } from '@/domain/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function generateSlots(slotDurationMinutes: number) {
  const morning: string[] = [];
  const afternoon: string[] = [];
  const start = 9 * 60;
  const end = 17 * 60;
  for (let m = start; m < end; m += slotDurationMinutes) {
    const hours = Math.floor(m / 60);
    const mins = m % 60;
    const isPM = hours >= 12;
    const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    const label = `${displayHour}:${mins.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
    if (hours < 12) morning.push(label);
    else afternoon.push(label);
  }
  return { morning, afternoon };
}

// Mock availability logic for UI demonstration
function getDayStatus(d: Date, today: Date) {
  const iso = isoDate(d);
  const isPast = iso < isoDate(today);
  if (isPast) return 'past';
  if (d.getDay() === 0) return 'closed'; // Sunday
  if (d.getDate() === 14 || d.getDate() === 20) return 'holiday';
  if (d.getDate() === 15 || d.getDate() === 22) return 'booked';
  return 'available';
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BookingFormPage() {
  const { clinicSlug } = useParams({ strict: false }) as { clinicSlug: string };

  // Clinic meta
  const [clinicName, setClinicName] = useState<string | null>(null);
  const [clinicLogo, setClinicLogo] = useState<string | null>(null);
  const [slotDuration, setSlotDuration] = useState(30);
  const [therapists, setTherapists] = useState<{ id: UUID; name: string }[]>([]);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);

  // Step state: 'visit' -> 'time' -> 'details' -> 'done'
  const [step, setStep] = useState<'visit' | 'time' | 'details' | 'done'>('visit');

  // Form fields
  const [visitType, setVisitType] = useState<'First visit' | 'Follow-up' | null>(null);
  const [preferredDate, setPreferredDate] = useState<string | null>(null);
  const [preferredTime, setPreferredTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [preferredTherapistId, setPreferredTherapistId] = useState('');
  const [notes, setNotes] = useState('');
  
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setChecking(false);
      setInvalid(true);
      return;
    }
    (async () => {
      try {
        const [info, therapistList] = await Promise.all([
          bookingService.getBookingClinicInfo(clinicSlug),
          bookingService.listBookingTherapists(clinicSlug),
        ]);
        setClinicName(info.name);
        setClinicLogo(info.logoPath);
        setSlotDuration(info.slotDurationMinutes);
        setTherapists(therapistList);
      } catch {
        setInvalid(true);
      }
      setChecking(false);
    })();
  }, [clinicSlug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setDetailsError('Full name and phone number are required.');
      return;
    }
    setBusy(true);
    setDetailsError(null);
    try {
      const fullNotes = `[${visitType}] ${notes}`.trim();
      await bookingService.submitAppointmentRequest(
        clinicSlug,
        name.trim(),
        phone.trim(),
        email.trim() || null,
        preferredTherapistId || null,
        fullNotes || null,
        preferredDate || null,
        preferredTime || null
      );
      setStep('done');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'Something went wrong.');
    }
    setBusy(false);
  }

  // ── Loading / error states ────────────────────────────────────────

  if (checking) return <Centered><div className="h-8 w-8 animate-spin rounded-full border-2 border-t-[var(--teal)]" /></Centered>;
  if (invalid) return <Centered><p className="text-[var(--muted)]">Booking not available.</p></Centered>;

  // ── Render Steps ────────────────────────────────────────────────────────
  
  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[var(--ink)] font-sans pb-24">
      {/* Contact Block & Header */}
      <header className="bg-white border-b border-[var(--border)] px-4 py-4 mb-6 sticky top-0 z-20 shadow-sm">
        <div className="mx-auto max-w-4xl flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            {clinicLogo ? (
              <img src={clinicLogo} alt="" className="h-10 w-10 rounded-full border shadow-sm" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-[var(--teal-light)] text-[var(--teal)] flex items-center justify-center text-lg">🏥</div>
            )}
            <div>
              <h1 className="text-lg font-bold">{clinicName}</h1>
              <p className="text-xs text-[var(--muted)]">Book an appointment online</p>
            </div>
          </div>
          <div className="text-sm text-right hidden sm:block text-[var(--muted)]">
            <p>123 Clinic Street, Suite 100 <a href="#" className="text-[var(--teal)] ml-1 hover:underline">Get directions</a></p>
            <p>Mon-Sat, 9am - 5pm · <a href="#" className="font-medium hover:underline">WhatsApp us</a></p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4">
        
        {/* Breadcrumb Steps */}
        {step !== 'done' && (
          <div className="flex items-center gap-2 text-sm font-medium mb-8 overflow-x-auto whitespace-nowrap">
            <StepButton label="1. Visit type" active={step === 'visit'} done={step !== 'visit' && visitType !== null} onClick={() => setStep('visit')} />
            <span className="text-[var(--border)]">›</span>
            <StepButton label="2. Date and time" active={step === 'time'} done={step === 'details'} onClick={() => visitType && setStep('time')} />
            <span className="text-[var(--border)]">›</span>
            <StepButton label="3. Details" active={step === 'details'} done={false} onClick={() => preferredTime && setStep('details')} />
          </div>
        )}

        {/* STEP 1: VISIT TYPE */}
        {step === 'visit' && (
          <div className="max-w-lg">
            <h2 className="text-2xl font-serif font-bold mb-6">What type of visit do you need?</h2>
            <div className="space-y-4">
              <button onClick={() => { setVisitType('First visit'); setStep('time'); }} className="w-full text-left p-6 rounded-2xl border border-[var(--border)] bg-white hover:border-[var(--teal)] hover:shadow-md transition-all group">
                <h3 className="font-semibold text-lg group-hover:text-[var(--teal)]">First visit</h3>
                <p className="text-sm text-[var(--muted)] mt-1">I haven't been to this clinic before, or it's a new injury.</p>
              </button>
              <button onClick={() => { setVisitType('Follow-up'); setStep('time'); }} className="w-full text-left p-6 rounded-2xl border border-[var(--border)] bg-white hover:border-[var(--teal)] hover:shadow-md transition-all group">
                <h3 className="font-semibold text-lg group-hover:text-[var(--teal)]">Follow-up</h3>
                <p className="text-sm text-[var(--muted)] mt-1">Continuing treatment for an existing condition.</p>
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: DATE AND TIME */}
        {step === 'time' && (
          <div>
            {/* Next Available Shortcut */}
            <div className="mb-6 inline-flex items-center gap-3 bg-teal-50 border border-teal-100 text-[var(--teal)] px-4 py-2 rounded-full text-sm font-medium cursor-pointer hover:bg-teal-100 transition-colors shadow-sm"
                 onClick={() => {
                   setPreferredDate(isoDate(new Date(Date.now() + 86400000))); // Just a dummy next day for demo
                   setPreferredTime('10:00 AM');
                   setStep('details');
                 }}>
              <span>Next available: Tomorrow</span>
              <div className="flex gap-2">
                <span className="bg-white px-2 py-0.5 rounded shadow-sm text-xs font-semibold">10:00 AM</span>
                <span className="bg-white px-2 py-0.5 rounded shadow-sm text-xs font-semibold">11:30 AM</span>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8 items-start">
              {/* Left Column: Calendar */}
              <div className="w-full lg:w-[420px] shrink-0 bg-white p-6 rounded-2xl border border-[var(--border)] shadow-sm">
                <MiniCalendar
                  selectedDate={preferredDate}
                  onSelect={(d) => {
                    setPreferredDate(d);
                    setPreferredTime(null);
                  }}
                />
              </div>

              {/* Right Column: Times / Waitlist */}
              <div className="w-full flex-1 lg:sticky lg:top-24">
                {preferredDate ? (
                  <TimePanel 
                    date={preferredDate} 
                    slotDuration={slotDuration} 
                    selectedTime={preferredTime}
                    onSelectTime={(t) => {
                      setPreferredTime(t);
                      setStep('details');
                    }}
                  />
                ) : (
                  <div className="h-full min-h-[300px] flex items-center justify-center border-2 border-dashed border-[var(--border)] rounded-2xl text-[var(--muted)] bg-white">
                    Select a date to see available times
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: DETAILS */}
        {step === 'details' && (
          <div className="max-w-xl">
            <h2 className="text-2xl font-serif font-bold mb-6">Enter your details</h2>
            <form onSubmit={onSubmit} className="bg-white p-6 sm:p-8 rounded-2xl border border-[var(--border)] shadow-sm space-y-5">
              
              <div className="bg-[#F9FAFB] p-5 rounded-xl mb-2 border border-[var(--border)]">
                <p className="text-xs font-bold uppercase text-[var(--muted)] tracking-wider mb-2">Appointment Summary</p>
                <p className="font-semibold text-lg">{visitType}</p>
                <p className="text-[var(--teal)] font-medium">
                  {new Date(preferredDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })} at {preferredTime}
                </p>
                <button type="button" onClick={() => setStep('time')} className="text-sm underline mt-3 text-[var(--muted)] hover:text-black">Change date or time</button>
              </div>

              <Field label="Full name *">
                <input type="text" required className={inputCls} value={name} onChange={e => setName(e.target.value)} />
              </Field>

              <Field label="Phone number *">
                <div className="flex shadow-sm rounded-xl">
                  <span className="flex items-center px-4 border border-r-0 border-[var(--border)] rounded-l-xl bg-[#F9FAFB] text-[var(--muted)] font-medium">🇮🇳 +91</span>
                  <input type="tel" required className={`${inputCls} rounded-l-none shadow-none`} value={phone} onChange={e => setPhone(e.target.value)} />
                </div>
              </Field>

              <Field label="Email address (optional)">
                <input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} />
              </Field>

              {therapists.length > 0 && (
                <Field label="Practitioner preference (optional)">
                  <select className={inputCls} value={preferredTherapistId} onChange={e => setPreferredTherapistId(e.target.value)}>
                    <option value="">Any available</option>
                    {therapists.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              )}

              <Field label="Notes (optional)">
                <textarea rows={3} className={inputCls} placeholder="Anything we should know?" value={notes} onChange={e => setNotes(e.target.value)} />
              </Field>

              {detailsError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{detailsError}</p>}

              <button type="submit" disabled={busy} className="w-full bg-[var(--teal)] text-white py-4 rounded-xl font-bold text-lg shadow-sm hover:opacity-90 disabled:opacity-50 mt-6 transition-opacity">
                {busy ? 'Submitting...' : 'Confirm Request'}
              </button>
            </form>
          </div>
        )}

        {/* STEP 4: DONE */}
        {step === 'done' && (
          <div className="max-w-xl mx-auto bg-white p-8 sm:p-12 rounded-2xl border border-[var(--border)] shadow-sm text-center">
            <div className="h-20 w-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">✓</div>
            <h2 className="text-3xl font-serif font-bold mb-3">Request received!</h2>
            <p className="text-[var(--muted)] mb-8 text-lg">Your request is <strong className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded">awaiting confirmation</strong>. We will review it and confirm shortly via WhatsApp or email.</p>
            
            <div className="bg-[#F9FAFB] p-6 rounded-2xl text-left mb-8 border border-[var(--border)]">
              <p className="font-semibold text-xl mb-1">{visitType}</p>
              <p className="text-[var(--teal)] font-medium text-lg">
                {new Date(preferredDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })} at {preferredTime}
              </p>
              <p className="text-sm text-[var(--muted)] mt-4">123 Clinic Street, Suite 100</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="px-6 py-3 border border-[var(--border)] rounded-xl font-semibold hover:bg-[#F9FAFB] shadow-sm transition-colors">Add to Calendar (.ics)</button>
              <button className="px-6 py-3 border border-[var(--border)] rounded-xl font-semibold hover:bg-[#F9FAFB] shadow-sm transition-colors">Get Directions</button>
            </div>
            <div className="mt-10 pt-6 border-t border-[var(--border)] text-sm text-[var(--muted)]">
              Need to make a change? <a href="#" className="underline hover:text-black">Request changes</a>
            </div>
          </div>
        )}

      </main>
      
      {/* Footer Branding */}
      <footer className="mt-20 text-center text-sm text-[var(--muted)]">
        Powered by <span className="font-bold">Thera.Net</span>
      </footer>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function StepButton({ label, active, done, onClick }: { label: string, active: boolean, done: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      disabled={!active && !done}
      className={`px-1 py-1 text-base transition-colors ${active ? 'text-[var(--teal)] font-bold border-b-2 border-[var(--teal)]' : done ? 'text-[var(--ink)] font-semibold hover:text-[var(--teal)] cursor-pointer' : 'text-[var(--muted)] font-medium opacity-50 cursor-not-allowed'}`}
    >
      {label}
    </button>
  );
}

function MiniCalendar({ selectedDate, onSelect }: { selectedDate: string | null, onSelect: (d: string) => void }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [viewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Mon=0

  const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  // Custom hatched pattern for holidays
  const hatchedStyle = {
    background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(251, 146, 60, 0.1) 4px, rgba(251, 146, 60, 0.1) 8px)',
    border: '1px solid rgba(251, 146, 60, 0.3)'
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <button onClick={() => setViewMonth(m => m - 1)} className="h-10 w-10 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[#F9FAFB]">‹</button>
        <span className="font-bold text-xl font-serif">{monthLabel}</span>
        <button onClick={() => setViewMonth(m => m + 1)} className="h-10 w-10 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[#F9FAFB]">›</button>
      </div>

      <div className="grid grid-cols-7 mb-3 gap-2">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} className="text-center text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="h-12 w-full" />;
          const cellDate = new Date(viewYear, viewMonth, day);
          const status = getDayStatus(cellDate, today);
          const iso = isoDate(cellDate);
          const isSel = iso === selectedDate;

          let btnCls = "h-12 w-full rounded-xl font-semibold text-base flex items-center justify-center transition-all ";
          let extraStyle = {};
          let title = "";

          if (isSel) {
            btnCls += "bg-[var(--teal)] text-white shadow-md border border-transparent";
          } else if (status === 'past') {
            btnCls += "opacity-0 cursor-default";
            return <div key={i} className={btnCls} />;
          } else if (status === 'closed') {
            btnCls += "bg-[#F9FAFB] text-[var(--muted)] opacity-50 cursor-not-allowed";
            title = "Closed";
          } else if (status === 'holiday') {
            extraStyle = hatchedStyle;
            btnCls += "text-orange-800 hover:opacity-80";
            title = "Holiday / Clinic Closure";
          } else if (status === 'booked') {
            btnCls += "border border-dashed border-[var(--muted)] text-[var(--ink)] hover:border-[var(--teal)]";
            title = "Fully booked";
          } else {
            btnCls += "bg-teal-50/40 text-[var(--ink)] hover:bg-teal-50";
            title = "Available";
          }

          return (
            <button key={i} style={extraStyle} title={title} onClick={() => onSelect(iso)} className={btnCls}>
              {day}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-8 flex flex-wrap gap-4 text-xs font-medium text-[var(--muted)] border-t border-[var(--border)] pt-5">
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-teal-50/40"></div> Available</div>
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded border border-dashed border-[var(--muted)]"></div> Fully booked</div>
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-[#F9FAFB]"></div> Closed</div>
        <div className="flex items-center gap-2" title="Gandhi Jayanti (Oct 2)"><div className="w-4 h-4 rounded border border-orange-200" style={{background: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(251, 146, 60, 0.15) 3px, rgba(251, 146, 60, 0.15) 6px)'}}></div> Holiday</div>
      </div>
    </div>
  );
}

function TimePanel({ date, slotDuration, selectedTime, onSelectTime }: { date: string, slotDuration: number, selectedTime: string | null, onSelectTime: (t: string) => void }) {
  const d = new Date(date + 'T00:00:00');
  const status = getDayStatus(d, new Date());
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  if (status === 'closed' || status === 'holiday') {
    return (
      <div className="bg-white p-8 rounded-2xl border border-[var(--border)] shadow-sm text-center">
        <h3 className="font-serif text-2xl font-bold mb-3">{dateStr}</h3>
        <p className="text-[var(--muted)] mb-6 text-lg">The clinic is closed on this day.</p>
        <button className="text-[var(--teal)] font-semibold hover:underline">See next available day</button>
      </div>
    );
  }

  if (status === 'booked') {
    return (
      <div className="bg-white p-8 rounded-2xl border border-[var(--border)] shadow-sm text-center">
        <h3 className="font-serif text-2xl font-bold mb-3">{dateStr}</h3>
        <p className="text-[var(--muted)] mb-8 text-lg">This day is fully booked.</p>
        <button className="w-full bg-[var(--ink)] text-white py-4 rounded-xl font-bold hover:bg-black transition-colors shadow-sm">
          Notify me if a slot opens
        </button>
        <button className="mt-6 text-[var(--teal)] font-semibold hover:underline">See next available day</button>
      </div>
    );
  }

  const { morning, afternoon } = generateSlots(slotDuration);

  return (
    <div className="bg-white p-6 sm:p-8 rounded-2xl border border-[var(--border)] shadow-sm">
      <h3 className="font-serif text-2xl font-bold mb-8 pb-4 border-b border-[var(--border)]">{dateStr}</h3>
      
      <div className="mb-8">
        <p className="text-sm font-bold uppercase text-[var(--muted)] mb-4 tracking-wide">Morning</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {morning.map(t => (
            <button key={t} onClick={() => onSelectTime(t)} className={`py-3.5 rounded-xl border text-sm font-bold transition-all shadow-sm ${selectedTime === t ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : 'border-[var(--border)] hover:border-[var(--teal)] bg-white text-[var(--ink)]'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-bold uppercase text-[var(--muted)] mb-4 tracking-wide">Afternoon</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {afternoon.map(t => (
            <button key={t} onClick={() => onSelectTime(t)} className={`py-3.5 rounded-xl border text-sm font-bold transition-all shadow-sm ${selectedTime === t ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : 'border-[var(--border)] hover:border-[var(--teal)] bg-white text-[var(--ink)]'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full p-4 bg-white border border-[var(--border)] rounded-xl focus:outline-none focus:border-[var(--teal)] transition-colors shadow-sm text-base";
function Field({ label, children }: { label: string, children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-bold mb-2 text-[var(--ink)]">{label}</span>
      {children}
    </label>
  );
}
function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center">{children}</div>;
}
