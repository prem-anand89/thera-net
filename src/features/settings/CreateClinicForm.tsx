import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { setActiveClinic } from '@/app/useActiveClinic';
import { signOutSafely } from '@/app/signOut';
import { catalogService, repos } from '@/services';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import { nextUnusedColor } from '@/components/schedule/scheduleColors';
import { ServiceCatalogTemplateEditor } from '@/features/onboarding/ServiceCatalogTemplateEditor';
import { cleanClinicCode, clinicCode, isValidClinicCode } from '@/domain/clinicCode';
import { browserTimezone, countryCodeForTimezone } from '@/domain/clinicRegion';
import { firstDuplicateName } from '@/domain/nameCheck';
import {
  type CatalogTemplateDraft,
  catalogItemsFromDrafts,
  createBlankStarterCatalogDrafts,
  servicesReadyToStart,
} from '@/domain/onboardingCatalogTemplates';
import type { CareLocation, Clinic } from '@/domain/types';
import { rowToDomain } from '@/repositories/rowMapping';
import { syncEngine } from '@/sync/engine';
import { getSupabase } from '@/lib/supabase';
import { toFriendlyMessage } from '@/lib/errors';

interface CreateClinicFormProps {
  onSuccess: () => void;
  /** `'page'` (default) is the zero-clinic-account screen: heading and a Sign out fallback, since there is nowhere
   *  else to go yet. `'dialog'` is the same two screens, bare, to slot inside a modal shell (`AddClinicDialog`)
   *  that supplies its own heading and a Cancel affordance. */
  variant?: 'page' | 'dialog';
}

/**
 * Clinic setup in two short screens on one page: Your practice, then Your services. Both screens are client state
 * only; nothing is created until the final Start tap, so there is never a clinic without services.
 *
 * Creation is a one-time, online-only operation, so it goes through the create_clinic_with_admin() RPC (one
 * synchronous, authoritative round trip; its AFTER INSERT trigger adds the creator as admin in the same transaction)
 * rather than the local-first outbox. The RPC also marks onboarding complete. The owner's therapist row and the
 * priced services are then written through the normal local-first repos, so they are on this device at once.
 */
export function CreateClinicForm({ onSuccess, variant = 'page' }: CreateClinicFormProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'practice' | 'services'>('practice');
  const [name, setName] = useState('');
  const [yourName, setYourName] = useState('');
  const [iTreat, setITreat] = useState(true);
  const [atClinic, setAtClinic] = useState(true);
  const [atHome, setAtHome] = useState(false);
  /** null = use the code made from the name; a string = the user edited it. */
  const [codeEdit, setCodeEdit] = useState<string | null>(null);
  const [chargesPatients, setChargesPatients] = useState(true);
  const [drafts, setDrafts] = useState<CatalogTemplateDraft[]>(() => createBlankStarterCatalogDrafts());
  const [otherClinics, setOtherClinics] = useState<{ name: string; invoicePrefix?: string | null; walkInMrnoPrefix?: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set once the clinic exists on the server but a later local write failed: Start becomes Continue. */
  const [created, setCreated] = useState(false);

  // Pre-fill "Your name" from the account, never over something already typed.
  useEffect(() => {
    let live = true;
    void getSupabase()
      ?.auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata as { full_name?: string; name?: string } | undefined;
        const known = (meta?.full_name || meta?.name || '').trim();
        if (live && known) setYourName((cur) => cur || known);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void repos.clinics
      .list()
      .then((rows) => {
        if (live) setOtherClinics(rows as typeof otherClinics);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const derivedCode = clinicCode(name);
  const code = codeEdit ?? derivedCode;
  const codeOk = codeEdit === null || isValidClinicCode(codeEdit);
  const locations: CareLocation[] = [...(atClinic ? (['clinic'] as const) : []), ...(atHome ? (['home'] as const) : [])];
  const practiceOk = name.trim() !== '' && yourName.trim() !== '' && codeOk && locations.length > 0;
  const sameCodeClinic = code ? otherClinics.find((c) => [c.invoicePrefix, c.walkInMrnoPrefix].some((p) => p?.toUpperCase() === code)) : undefined;

  const savedNames = useMemo(() => catalogItemsFromDrafts('', drafts, '', chargesPatients).map((i) => i.name), [drafts, chargesPatients]);
  const twice = firstDuplicateName(savedNames);
  const canStart = servicesReadyToStart(drafts, chargesPatients) && !twice;

  function chooseCharges(next: boolean) {
    setChargesPatients(next);
    // Prices typed on one path are not carried to the other: Yes always starts with blank boxes.
    if (next !== chargesPatients) setDrafts((d) => d.map((r) => ({ ...r, basePricePaise: null })));
  }

  function finish() {
    onSuccess();
    if (variant === 'page') void navigate({ to: '/workspace' });
  }

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    if (step !== 'services') return;
    if (created) {
      finish();
      return;
    }
    if (!practiceOk || !canStart) return;

    setBusy(true);
    setError(null);

    let clinic: Clinic | null = null;
    try {
      const supabase = getSupabase();
      if (!supabase) {
        setError('Supabase not configured');
        setBusy(false);
        return;
      }

      // create_clinic_with_admin raises 'not signed in' server-side when auth.uid() is null, which happens when the
      // session never got picked up (confirming a signup's email in a different browser or tab). Checking with a
      // round trip first gives a specific, actionable message instead of the RPC's generic failure.
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError(
          "You're not signed in — this can happen right after confirming your email in a different browser or tab. Sign out and sign back in, then try again."
        );
        setBusy(false);
        return;
      }
      const userId = userData.user.id;

      const zone = browserTimezone();
      const { data, error: rpcError } = await supabase.rpc('create_clinic_with_admin', {
        p_name: name.trim(),
        p_invoice_prefix: code || 'INV',
        p_walk_in_mrno_prefix: code || null,
        p_timezone: zone,
        p_default_country_code: countryCodeForTimezone(zone),
        p_care_locations: locations,
        p_complete_onboarding: true,
        p_charges_patients: chargesPatients,
      });
      if (rpcError) {
        setError(toFriendlyMessage(rpcError));
        setBusy(false);
        return;
      }

      clinic = rowToDomain<Clinic>(data as Record<string, unknown>);
      // The server already confirmed this row (and added us as admin): cache it without queuing a push of our own.
      await repos.clinics.putLocal(clinic);
      const now = new Date().toISOString();
      if (iTreat) {
        await repos.therapists.put({
          id: crypto.randomUUID(),
          clinicId: clinic.id,
          name: yourName.trim(),
          userId,
          active: true,
          registrationNo: null,
          phone: null,
          // Confirmed here, so the first visit to Workspace is not intercepted by the "How you appear on bills" page.
          profileConfirmedAt: now,
          color: nextUnusedColor([]),
          updatedAt: now,
        });
      }
      await catalogService.addServices(catalogItemsFromDrafts(clinic.id, drafts, now, chargesPatients));
      await setActiveClinic(clinic.id);
      void syncEngine.schedule(0);
      setBusy(false);
      finish();
    } catch (err) {
      console.error('Clinic creation error:', err);
      setError(err instanceof Error ? toFriendlyMessage(err) : 'Failed to create clinic');
      setBusy(false);
      if (clinic) {
        // The clinic exists: use it. The setup guide shows whatever is missing (therapist, prices).
        setCreated(true);
        try {
          await setActiveClinic(clinic.id);
          void syncEngine.schedule(0);
        } catch (activateErr) {
          console.error('Could not open the new clinic:', activateErr);
        }
      }
    }
  }

  const practiceScreen = (
    <div className="space-y-4">
      <Field label="Practice or clinic name">
        <input
          type="text"
          className={inputCls}
          placeholder="e.g. Apex Physio"
          autoComplete="organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      {codeEdit === null ? (
        derivedCode ? (
          <p className="-mt-2 text-xs text-[var(--muted)]">
            Bills and patient IDs start with {derivedCode} ·{' '}
            <button type="button" className="font-semibold text-[var(--teal)] hover:underline" onClick={() => setCodeEdit(derivedCode)}>
              Edit
            </button>
          </p>
        ) : null
      ) : (
        <Field label="Clinic code" hint={codeOk ? 'Bills and patient IDs start with this.' : '2 to 6 letters or numbers'}>
          <input
            type="text"
            aria-label="Clinic code"
            className={`${inputCls} font-mono uppercase`}
            value={codeEdit}
            maxLength={6}
            autoCapitalize="characters"
            onChange={(e) => setCodeEdit(cleanClinicCode(e.target.value))}
          />
        </Field>
      )}
      {sameCodeClinic ? (
        <p className="-mt-2 text-xs text-[var(--amber-strong)]">
          Your other clinic {sameCodeClinic.name} also uses {code}.
        </p>
      ) : null}
      <Field label="Your name">
        <input
          type="text"
          className={inputCls}
          autoComplete="name"
          value={yourName}
          onChange={(e) => setYourName(e.target.value)}
        />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-[var(--ink)]">
        <input type="checkbox" className="h-5 w-5 accent-[var(--teal)]" checked={iTreat} onChange={(e) => setITreat(e.target.checked)} />
        I treat patients myself
      </label>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-label font-medium text-[var(--muted)]">Where do you see patients?</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--ink)]">
          <input type="checkbox" className="h-5 w-5 accent-[var(--teal)]" checked={atClinic} onChange={(e) => setAtClinic(e.target.checked)} />
          At a clinic or hospital
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--ink)]">
          <input type="checkbox" className="h-5 w-5 accent-[var(--teal)]" checked={atHome} onChange={(e) => setAtHome(e.target.checked)} />
          Home visits
        </label>
        {locations.length === 0 ? <p className="text-xs text-[var(--rust)]">Choose at least one place</p> : null}
      </fieldset>
      <button type="button" disabled={!practiceOk} className={`${btnPrimary} w-full`} onClick={() => setStep('services')}>
        Next: your services
      </button>
      {variant === 'page' && (
        <button type="button" className={`${btnSecondary} w-full`} onClick={() => void signOutSafely()}>
          Sign out
        </button>
      )}
    </div>
  );

  const servicesScreen = (
    <div className="space-y-4">
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-semibold text-[var(--ink)]">Do your patients pay you?</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--ink)]">
          <input type="radio" name="charges-patients" className="h-5 w-5 accent-[var(--teal)]" checked={chargesPatients} onChange={() => chooseCharges(true)} />
          Yes, I charge patients
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--ink)]">
          <input type="radio" name="charges-patients" className="h-5 w-5 accent-[var(--teal)]" checked={!chargesPatients} onChange={() => chooseCharges(false)} />
          No: I don't bill, or the hospital bills
        </label>
      </fieldset>
      <ServiceCatalogTemplateEditor
        drafts={drafts}
        onChange={setDrafts}
        showPrices={chargesPatients}
        rowNotes={false}
        hint={
          chargesPatients
            ? "Price at least one service to start logging visits. Unpriced ones aren't added; you can add more in Settings."
            : 'Name the services you give. No prices needed.'
        }
      />
      {twice ? <p role="alert" className="text-sm text-[var(--rust)]">&quot;{twice}&quot; is listed twice. Give each service its own name.</p> : null}
      <ErrorNote message={error} />
      <div className="sticky bottom-0 -mx-1 flex gap-2 bg-[var(--surface)] px-1 pb-1 pt-2">
        {!created && (
          <button type="button" disabled={busy} className={btnSecondary} onClick={() => setStep('practice')}>
            Back
          </button>
        )}
        <button type="submit" disabled={busy || (!created && !canStart)} className={`${btnPrimary} flex-1`}>
          {busy ? 'Setting up your practice…' : created ? 'Continue' : 'Start using Thera.Net'}
        </button>
      </div>
    </div>
  );

  const formEl = (
    <form onSubmit={handleStart} className="space-y-4">
      {step === 'practice' ? practiceScreen : servicesScreen}
    </form>
  );

  if (variant === 'dialog') return formEl;

  return (
    <div className="mx-auto mt-4 max-w-md px-4 sm:mt-10">
      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
        <h1 className="font-display text-2xl font-semibold leading-tight text-[var(--ink)]">
          {step === 'practice' ? 'Your practice' : 'Your services'}
        </h1>
        <p className="mb-6 mt-2 text-sm text-[var(--muted)]">
          {step === 'practice' ? 'Two short steps and you can log your first visit.' : 'These appear when you log a visit.'}
        </p>
        {formEl}
      </div>
    </div>
  );
}
