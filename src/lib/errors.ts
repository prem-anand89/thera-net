import type { PostgrestError } from '@supabase/supabase-js';
import { hasSupabaseConfig } from './env';

const GENERIC_FALLBACK = 'Something went wrong. Try again, and if it keeps happening, tell your admin.';
const OFFLINE_MESSAGE = "You're offline (or not connected to the server). Check your connection and try again.";

// Ordered [matcher, friendly message] pairs checked against the error message.
// Covers this app's own SQL `raise exception` text (all come back with Postgrest
// code P0001, so message matching is the only way to tell them apart) plus a
// few common unique-constraint names.
const MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [
    /issued invoices are immutable/i,
    'This invoice has already been issued and can no longer be edited. Create an amendment instead.',
  ],
  [
    /visit is on issued invoice.*it cannot be deleted/i,
    'This visit is on an issued invoice and cannot be deleted. Create an amendment instead.',
  ],
  [
    /visit is on issued invoice.*financial fields are frozen/i,
    'This visit is on an issued invoice, so its billing details are locked. Create an amendment instead.',
  ],
  [
    /not a member of this clinic/i,
    "You don't have access to this clinic. Try signing out and back in, or ask your admin.",
  ],
  [
    /one or more visits are missing, deleted, or already invoiced/i,
    'One of the selected visits is no longer available (it may already be on another invoice). Refresh and try again.',
  ],
  [
    /patient has \d+ visit\(s\); hide the patient instead/i,
    'This patient has recorded visits and cannot be permanently deleted. Use "Hide" instead.',
  ],
  [/patient not found/i, 'This patient could not be found. They may have been removed already — try refreshing.'],
  [/only clinic admins can wipe clinic data/i, 'Only clinic admins can do this. Ask an admin if you need it done.'],
  [
    /duplicate key value violates unique constraint "patients_clinic_id_mrno_key"/i,
    'A patient with this MR number already exists in this clinic.',
  ],
  [
    /duplicate key value violates unique constraint "service_catalog_clinic_id_name_key"/i,
    'A service with this name already exists.',
  ],
  [
    /duplicate key value violates unique constraint "invoices_clinic_id_invoice_no_key"/i,
    'An invoice with this number already exists.',
  ],
  [/duplicate key value violates unique constraint/i, 'That record already exists — check for a duplicate.'],
];

// Postgres/Postgrest error codes used as a fallback when no message pattern
// above matches. P0001 (generic raise exception) is deliberately excluded —
// this app's own exceptions all use it, so it can't distinguish between them.
const CODE_MESSAGES: Record<string, string> = {
  '23505': 'That record already exists — check for a duplicate.',
  '23503': "This action isn't allowed because other records still depend on it.",
  '42501': "You don't have permission to do that.",
};

function isPostgrestError(e: unknown): e is PostgrestError {
  return typeof e === 'object' && e !== null && 'message' in e && 'code' in e;
}

function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError && /fetch/i.test(e.message);
}

function matchPattern(message: string): string | undefined {
  return MESSAGE_PATTERNS.find(([pattern]) => pattern.test(message))?.[1];
}

/** Translate any thrown value from a catch block into a message safe to show a clinic user. */
export function toFriendlyMessage(e: unknown): string {
  if (!hasSupabaseConfig || isNetworkError(e)) return OFFLINE_MESSAGE;

  if (isPostgrestError(e)) {
    const byPattern = matchPattern(e.message);
    if (byPattern) return byPattern;
    const byCode = e.code && e.code !== 'P0001' ? CODE_MESSAGES[e.code] : undefined;
    return byCode ?? GENERIC_FALLBACK;
  }

  if (e instanceof Error) {
    return matchPattern(e.message) ?? e.message;
  }

  return GENERIC_FALLBACK;
}
