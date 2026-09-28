import { useState } from 'react';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';
import { getSupabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { useClinic } from '@/app/clinicContext';

export interface HelpFeedbackDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type Mode = 'menu' | 'bug' | 'feature' | 'support';

export function HelpFeedbackDialog({ isOpen, onClose }: HelpFeedbackDialogProps) {
  const [mode, setMode] = useState<Mode>('menu');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Structured fields
  const [severity, setSeverity] = useState('Medium');
  const [bugSteps, setBugSteps] = useState('');
  const [featureCategory, setFeatureCategory] = useState('Workflow');
  const [featureWhy, setFeatureWhy] = useState('');
  const [supportTopic, setSupportTopic] = useState('General');

  const { session } = useSession();
  const clinic = useClinic();

  if (!isOpen) return null;

  const handleClose = () => {
    if (!busy) {
      setMode('menu');
      setMessage('');
      setBugSteps('');
      setFeatureWhy('');
      setError(null);
      setSuccess(false);
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setBusy(true);
    setError(null);

    let finalMessage = '';
    if (mode === 'bug') {
      finalMessage = `Severity: ${severity}\n\nWhat went wrong:\n${message.trim()}`;
      if (bugSteps.trim()) finalMessage += `\n\nSteps to reproduce:\n${bugSteps.trim()}`;
    } else if (mode === 'feature') {
      finalMessage = `Category: ${featureCategory}\n\nThe Idea:\n${message.trim()}`;
      if (featureWhy.trim()) finalMessage += `\n\nWhy it's important:\n${featureWhy.trim()}`;
    } else {
      finalMessage = `Topic: ${supportTopic}\n\nMessage:\n${message.trim()}`;
    }

    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase client not found');

      const { error: invokeError } = await supabase.functions.invoke('brevo-mailer', {
        body: {
          type: 'feedback',
          category: mode,
          message: finalMessage,
          userId: session?.user.id,
          userName: session?.user.user_metadata?.display_name || session?.user.email,
          clinicId: clinic?.id,
        },
      });

      if (invokeError) throw invokeError;

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while sending your message.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-[var(--surface)] p-6 shadow-xl"
      >
          {success ? (
            <div className="text-center py-6">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="mb-2 text-lg font-semibold text-[var(--ink)]">Message Sent!</h2>
              <p className="mb-6 text-sm text-[var(--muted)]">Thank you! We've received your message and will review it shortly.</p>
              <button type="button" onClick={handleClose} className={btnSecondary}>
                Close
              </button>
            </div>
          ) : mode === 'menu' ? (
            <>
              <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Help & Feedback</h2>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setMode('bug')}
                  className="flex w-full items-center gap-4 rounded-lg border border-[var(--border)] p-4 text-left transition hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--rust)]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-[var(--ink)]">Report a Bug</h3>
                    <p className="text-xs text-[var(--muted)]">Something isn't working right.</p>
                  </div>
                </button>
                
                <button
                  type="button"
                  onClick={() => setMode('feature')}
                  className="flex w-full items-center gap-4 rounded-lg border border-[var(--border)] p-4 text-left transition hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--rust)]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-[var(--ink)]">Suggest a Feature</h3>
                    <p className="text-xs text-[var(--muted)]">I have an idea to make Thera.Net better.</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setMode('support')}
                  className="flex w-full items-center gap-4 rounded-lg border border-[var(--border)] p-4 text-left transition hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--rust)]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-[var(--ink)]">Get Support</h3>
                    <p className="text-xs text-[var(--muted)]">I need help using the app.</p>
                  </div>
                </button>
              </div>
              <div className="mt-6 flex justify-end">
                <button type="button" onClick={handleClose} className={btnSecondary}>Cancel</button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[var(--ink)]">
                  {mode === 'bug' && 'Report a Bug'}
                  {mode === 'feature' && 'Suggest a Feature'}
                  {mode === 'support' && 'Get Support'}
                </h2>
                <button
                  type="button"
                  onClick={() => { setMode('menu'); setError(null); }}
                  className="text-sm font-medium text-[var(--rust)] hover:underline"
                >
                  &larr; Back
                </button>
              </div>
              
              <div className="space-y-4">
                {mode === 'bug' && (
                  <>
                    <Field label="Severity">
                      <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputCls}>
                        <option value="Low">Low - Minor annoyance</option>
                        <option value="Medium">Medium - Feature isn't working right</option>
                        <option value="High">High - Completely blocked / Crashing</option>
                      </select>
                    </Field>
                    <Field label="What went wrong?">
                      <textarea required autoFocus disabled={busy} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} placeholder="Expected X, but Y happened..." />
                    </Field>
                    <Field label="Steps to reproduce (optional)">
                      <textarea disabled={busy} rows={2} value={bugSteps} onChange={(e) => setBugSteps(e.target.value)} className={inputCls} placeholder="1. Go to... 2. Click..." />
                    </Field>
                  </>
                )}

                {mode === 'feature' && (
                  <>
                    <Field label="Category">
                      <select value={featureCategory} onChange={(e) => setFeatureCategory(e.target.value)} className={inputCls}>
                        <option value="Workflow">Workflow / Day-to-day use</option>
                        <option value="Billing">Billing & Revenue</option>
                        <option value="Patients">Patients & Notes</option>
                        <option value="UI">UI / Design</option>
                        <option value="Other">Other</option>
                      </select>
                    </Field>
                    <Field label="The Idea">
                      <textarea required autoFocus disabled={busy} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} placeholder="What should we build?" />
                    </Field>
                    <Field label="Why is this important? (optional)">
                      <textarea disabled={busy} rows={2} value={featureWhy} onChange={(e) => setFeatureWhy(e.target.value)} className={inputCls} placeholder="How would this help your clinic?" />
                    </Field>
                  </>
                )}

                {mode === 'support' && (
                  <>
                    <div className="mb-2 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--paper)] p-3 text-sm">
                      <h3 className="mb-2 font-medium text-[var(--ink)]">Quick Guides:</h3>
                      
                      <details className="mb-2 group">
                        <summary className="cursor-pointer font-medium text-[var(--teal)] hover:underline">How do I set up my clinic?</summary>
                        <p className="mt-1 pl-4 text-xs leading-relaxed text-[var(--muted)]">
                          Open the <strong>Settings</strong> page from your Account Menu. 
                          In the <strong>Profile</strong> tab, you can set your MRNO prefix.
                          In the <strong>Catalog</strong> tab, define the services you offer.
                          In the <strong>Team</strong> tab, you can invite other therapists or front desk staff.
                        </p>
                      </details>

                      <details className="mb-2 group">
                        <summary className="cursor-pointer font-medium text-[var(--teal)] hover:underline">How does offline mode work?</summary>
                        <p className="mt-1 pl-4 text-xs leading-relaxed text-[var(--muted)]">
                          Thera.Net works without internet! You can search patients, log visits, and write clinical notes entirely offline. They will securely save to your device and automatically sync the moment your internet returns. <em>(Note: Generating invoices requires an active connection to ensure sequential numbering).</em>
                        </p>
                      </details>

                      <details className="mb-2 group">
                        <summary className="cursor-pointer font-medium text-[var(--teal)] hover:underline">How do advances and daybook math work?</summary>
                        <p className="mt-1 pl-4 text-xs leading-relaxed text-[var(--muted)]">
                          When you record a Patient Advance, it shows up as cash collected on the Daybook <strong>today</strong>. When they use that advance for a visit later, the app automatically pays the visit but <strong>excludes</strong> it from that day's cash collection to prevent double-counting your revenue.
                        </p>
                      </details>

                      <details className="group">
                        <summary className="cursor-pointer font-medium text-[var(--teal)] hover:underline">How do I give billing access to staff?</summary>
                        <p className="mt-1 pl-4 text-xs leading-relaxed text-[var(--muted)]">
                          Go to <strong>Settings &rarr; Features</strong>. You can toggle whether "Everyone" or only "Billing Staff / Admins" are allowed to issue invoices. 
                        </p>
                      </details>

                      <details className="mt-2 group">
                        <summary className="cursor-pointer font-medium text-[var(--teal)] hover:underline">How do I add a second clinic?</summary>
                        <p className="mt-1 pl-4 text-xs leading-relaxed text-[var(--muted)]">
                          Click your profile icon in the top right. If you are an admin, you will see an <strong>+ Add another clinic</strong> button in the menu. Once created, you can seamlessly switch between clinics from that same menu.
                        </p>
                      </details>
                    </div>

                    <h3 className="mt-4 mb-2 font-medium text-[var(--ink)] border-t border-[var(--border)] pt-4">Still need help? Send us a message:</h3>
                    
                    <Field label="Topic">
                      <select value={supportTopic} onChange={(e) => setSupportTopic(e.target.value)} className={inputCls}>
                        <option value="General">General Question</option>
                        <option value="Billing">Billing issue</option>
                        <option value="Sync">Sync / Offline issue</option>
                        <option value="Account">Account / Login</option>
                      </select>
                    </Field>
                    <Field label="How can we help?">
                      <textarea required disabled={busy} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} placeholder="Describe what you need help with (we will email you back)..." />
                    </Field>
                  </>
                )}

                <ErrorNote message={error} />

                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={handleClose} disabled={busy} className={btnSecondary}>
                    Cancel
                  </button>
                  <button type="submit" disabled={busy || !message.trim()} className={btnPrimary}>
                    {busy ? 'Sending...' : 'Send Message'}
                  </button>
                </div>
              </div>
            </form>
          )}
      </div>
    </div>
  );
}
