import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { getSupabase } from '@/lib/supabase';
import { hasSupabaseConfig } from '@/lib/env';
import { btnPrimary } from '@/components/ui';

/**
 * Public, unauthenticated patient feedback form — /f/$token. No login, no
 * Shell chrome (see Shell.tsx's early-return for this path). The token is
 * the entire authorization; get_feedback_request_by_token()/
 * submit_feedback_response() are the only anonymous write path in the app
 * (docs/HANDOFF-patient-comms.md). Both RPCs return the same generic
 * "invalid or expired" message regardless of the real reason, so this page
 * never tries to distinguish "not found" from "expired" from "already
 * responded" — showing that distinction back to the caller would turn the
 * endpoint into an oracle for probing which tokens exist.
 */
export function FeedbackFormPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const [clinicName, setClinicName] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setChecking(false);
      setInvalid(true);
      return;
    }
    const supabase = getSupabase()!;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_feedback_request_by_token', {
        p_token: token,
      });
      if (rpcError || !data) {
        setInvalid(true);
      } else {
        setClinicName(data as string);
      }
      setChecking(false);
    })();
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setError('Please choose a rating.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await getSupabase()!.rpc('submit_feedback_response', {
      p_token: token,
      p_rating: rating,
      p_comment: comment.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      // Deliberately not toFriendlyMessage() here — that helper falls back
      // to a generic message for this RPC's error code (P0001), but this
      // RPC's raised text IS the message meant for the patient to read.
      setError(rpcError.message);
      return;
    }
    setDone(true);
  }

  if (checking) {
    return <Centered>Loading…</Centered>;
  }

  if (invalid) {
    return (
      <Centered>
        <p className="text-sm text-[var(--muted)]">
          This link is invalid or has expired. Please contact the clinic if you'd still like to
          share feedback.
        </p>
      </Centered>
    );
  }

  if (done) {
    return (
      <Centered>
        <p className="text-sm text-[var(--ink)]">Thank you for your feedback!</p>
      </Centered>
    );
  }

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <div className="mb-6 text-center">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">{clinicName}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">How was your visit?</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              onClick={() => setRating(n)}
              className="min-h-11 min-w-11 text-3xl leading-none"
            >
              <span className={n <= rating ? 'text-[var(--rust)]' : 'text-[var(--border)]'}>★</span>
            </button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Anything you'd like to share? (optional)
          </span>
          <textarea
            className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-2 text-sm text-[var(--ink)]"
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-[var(--rust)]">{error}</p>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? 'Submitting…' : 'Submit feedback'}
        </button>
      </form>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
