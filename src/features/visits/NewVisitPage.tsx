import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, visitService, patientService, directPaymentService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { DUPLICATE_NAME_THRESHOLD, nameSimilarity } from '@/domain/nameSimilarity';
import {
  effectivePricePerSession,
  referringSourceDetailLabel,
  REFERRING_SOURCE_LABELS,
  type Patient,
  type PaymentMethod,
  type ReferringSource,
  type UUID,
} from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import {
  Field,
  inputCls,
  btnPrimary,
  btnSecondary,
  ErrorNote,
  RupeeInput,
  SectionCard,
} from '@/components/ui';

interface OpenPackage {
  packageGroupId: UUID;
  serviceCatalogId: UUID;
  serviceName: string;
  logged: number;
  packageTotal: number;
  startedOn: string;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];

export function NewVisitPage() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { repeatVisitId?: string; newPatient?: string };

  // Patient selection
  const [query, setQuery] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: '',
    mrno: '',
    age: '',
    sex: '',
    phone: '',
    primaryCondition: '',
    referringSource: '' as ReferringSource | '',
    referringSourceDetail: '',
  });

  // Visit fields
  const today = new Date().toISOString().slice(0, 10);
  const [visitDate, setVisitDate] = useState(today);
  const [therapistId, setTherapistId] = useState('');
  const [mode, setMode] = useState<'new' | 'continuation'>('new');
  const [serviceCatalogId, setServiceCatalogId] = useState('');
  const [openPackageId, setOpenPackageId] = useState('');
  const [billOverride, setBillOverride] = useState<number | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentChoice, setPaymentChoice] = useState<'paid' | 'pending'>('paid');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [pendingNote, setPendingNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id), [clinic.id]);
  const matches = useLiveQuery(
    () => (patient ? Promise.resolve([]) : repos.patients.search(clinic.id, query)),
    [clinic.id, query, patient]
  );
  const allPatients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);

  // Live typo-level near-miss check as the name is typed (MRNO stays the
  // true identifier) — surfaces before submit so "Ramesh Kummar" is caught
  // while the receptionist is still looking at the field, not after.
  const duplicateMatch = useMemo(() => {
    const typed = newPatient.name.trim();
    if (!typed) return null;
    let best: { name: string; mrno: string; score: number } | null = null;
    for (const p of (allPatients ?? []).filter((p) => !p.deletedAt)) {
      const score = nameSimilarity(p.name, typed);
      if (!best || score > best.score) best = { name: p.name, mrno: p.mrno, score };
    }
    return best && best.score >= DUPLICATE_NAME_THRESHOLD ? best : null;
  }, [allPatients, newPatient.name]);

  const openPackages = useLiveQuery(async (): Promise<OpenPackage[]> => {
    if (!patient) return [];
    const visits = await repos.visits.list({ clinicId: clinic.id, patientId: patient.id });
    const groups = new Map<string, typeof visits>();
    for (const v of visits) {
      if (!v.packageGroupId) continue;
      if (!groups.has(v.packageGroupId)) groups.set(v.packageGroupId, []);
      groups.get(v.packageGroupId)!.push(v);
    }
    const items = await repos.catalog.list(clinic.id, true);
    const nameOf = new Map(items.map((i) => [i.id, i.name]));
    const open: OpenPackage[] = [];
    for (const [gid, group] of groups) {
      const total = group[0].packageTotal ?? 1;
      if (group.length >= total) continue;
      const sorted = [...group].sort((a, b) => a.visitDate.localeCompare(b.visitDate));
      open.push({
        packageGroupId: gid,
        serviceCatalogId: sorted[0].serviceCatalogId,
        serviceName: nameOf.get(sorted[0].serviceCatalogId) ?? 'Package',
        logged: group.length,
        packageTotal: total,
        startedOn: sorted[0].visitDate,
      });
    }
    return open.sort((a, b) => b.startedOn.localeCompare(a.startedOn));
  }, [clinic.id, patient?.id]);

  // "Repeat last visit": pre-fill patient/therapist/condition from the
  // visit being repeated, then — once that patient's open packages have
  // loaded — select the matching package so this becomes its next session.
  const repeatVisit = useLiveQuery(
    () => (search.repeatVisitId ? repos.visits.get(search.repeatVisitId) : undefined),
    [search.repeatVisitId]
  );

  // Workspace's "+ New patient" quick action links here with ?newPatient=1
  // so the create-patient form is already open, skipping the search step.
  useEffect(() => {
    if (search.newPatient && !patient) setCreatingPatient(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.newPatient]);

  useEffect(() => {
    if (!repeatVisit || patient) return;
    (async () => {
      const p = await repos.patients.get(repeatVisit.patientId);
      if (p) {
        setPatient(p);
        setCondition(repeatVisit.condition ?? p.primaryCondition ?? '');
      }
      setTherapistId(repeatVisit.therapistId);
      setMode('continuation');
    })();
  }, [repeatVisit, patient]);

  useEffect(() => {
    if (!repeatVisit?.packageGroupId || !openPackages?.length) return;
    const match = openPackages.find((op) => op.packageGroupId === repeatVisit.packageGroupId);
    if (match) setOpenPackageId(match.packageGroupId);
  }, [repeatVisit, openPackages]);

  const selectedService = useMemo(
    () => (catalog ?? []).find((c) => c.id === serviceCatalogId),
    [catalog, serviceCatalogId]
  );
  const selectedPackage = useMemo(
    () => (openPackages ?? []).find((p) => p.packageGroupId === openPackageId),
    [openPackages, openPackageId]
  );

  const catalogPricePaise = mode === 'continuation' ? 0 : (selectedService?.basePricePaise ?? 0);
  const billPaise = billOverride ?? catalogPricePaise;
  const adjustmentPaise = billPaise - catalogPricePaise;

  const categories = useMemo(() => {
    const map = new Map<string, NonNullable<typeof catalog>>();
    for (const item of catalog ?? []) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return [...map.entries()];
  }, [catalog]);

  async function createPatient() {
    setError(null);
    try {
      const created = await patientService.create({
        clinicId: clinic.id,
        name: newPatient.name,
        mrno: newPatient.mrno || undefined,
        age: newPatient.age ? Number(newPatient.age) : null,
        sex: (newPatient.sex || null) as Patient['sex'],
        phone: newPatient.phone || null,
        primaryCondition: newPatient.primaryCondition || null,
        referringSource: newPatient.referringSource || null,
        referringSourceDetail: newPatient.referringSourceDetail || null,
      });
      setPatient(created);
      setCreatingPatient(false);
      if (created.primaryCondition) setCondition(created.primaryCondition);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function save() {
    setError(null);
    if (!patient) return setError('Select or create a patient first');
    if (!therapistId) return setError('Select a therapist');
    if (mode === 'new' && !serviceCatalogId) return setError('Select a service');
    if (mode === 'continuation' && !selectedPackage) return setError('Select the open package');
    setBusy(true);
    try {
      const visit = await visitService.create({
        clinicId: clinic.id,
        patientId: patient.id,
        therapistId,
        visitDate,
        serviceCatalogId: mode === 'continuation' ? selectedPackage!.serviceCatalogId : serviceCatalogId,
        condition,
        treatmentNotes: notes,
        actualBillPaise: billOverride ?? undefined,
        adjustmentReason,
        ...(mode === 'continuation'
          ? {
              isContinuation: true,
              packageGroupId: selectedPackage!.packageGroupId,
              sessionIndex: selectedPackage!.logged + 1,
              packageTotal: selectedPackage!.packageTotal,
            }
          : {}),
        ...(billPaise > 0 && paymentChoice === 'pending'
          ? { pendingPaymentNote: pendingNote || null }
          : {}),
      });

      // Billed and marked paid on the spot — log the cash/UPI/etc payment
      // immediately so it counts toward "collected" without needing an
      // invoice. A ₹0 continuation session or an explicit "collect later"
      // choice skips this; the latter shows up on Workspace's pending list.
      if (billPaise > 0 && paymentChoice === 'paid') {
        await directPaymentService.logPayment(clinic.id, visit.id, billPaise, paymentMethod, visitDate, null);
      }

      void navigate({ to: '/workspace' });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">New visit</h1>

      <SectionCard title="Patient">
        {patient ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-sm font-medium text-[var(--ink)]">{patient.name}</div>
              <div className="text-xs text-[var(--muted)]">
                Patient ID {patient.mrno}
                {patient.age != null && ` · ${patient.age}y`}
                {patient.sex && ` · ${patient.sex}`}
              </div>
            </div>
            <button className={btnSecondary} onClick={() => setPatient(null)}>
              Change
            </button>
          </div>
        ) : creatingPatient ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name *">
              <input
                className={inputCls}
                value={newPatient.name}
                onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
              />
            </Field>
            {duplicateMatch && (
              <p className="col-span-2 rounded-md border border-[var(--rust)] bg-[var(--rust-light)] px-3 py-2 text-sm text-[var(--rust)]">
                ⚠ A patient named "{duplicateMatch.name}" (Patient ID {duplicateMatch.mrno}) already exists.
                If this is the same person, use "Back to search" below instead of creating a new
                record.
              </p>
            )}
            <Field label="Patient ID (leave blank to auto-generate for walk-ins)">
              <input
                className={inputCls}
                placeholder="Existing Patient ID, if any"
                value={newPatient.mrno}
                onChange={(e) => setNewPatient({ ...newPatient, mrno: e.target.value })}
              />
            </Field>
            <Field label="Age">
              <input
                type="number"
                className={inputCls}
                value={newPatient.age}
                onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
              />
            </Field>
            <Field label="Sex">
              <select
                className={inputCls}
                value={newPatient.sex}
                onChange={(e) => setNewPatient({ ...newPatient, sex: e.target.value })}
              >
                <option value="">—</option>
                <option value="M">M</option>
                <option value="F">F</option>
                <option value="Other">Other</option>
              </select>
            </Field>
            <Field label="Phone">
              <input
                className={inputCls}
                value={newPatient.phone}
                onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
              />
            </Field>
            <Field label="Primary condition">
              <input
                className={inputCls}
                placeholder="e.g. Neck Pain"
                value={newPatient.primaryCondition}
                onChange={(e) => setNewPatient({ ...newPatient, primaryCondition: e.target.value })}
              />
            </Field>
            <Field label="Referring source">
              <select
                className={inputCls}
                value={newPatient.referringSource}
                onChange={(e) =>
                  setNewPatient({
                    ...newPatient,
                    referringSource: e.target.value as ReferringSource | '',
                    referringSourceDetail: '',
                  })
                }
              >
                <option value="">—</option>
                {(Object.entries(REFERRING_SOURCE_LABELS) as [ReferringSource, string][]).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </Field>
            {referringSourceDetailLabel(newPatient.referringSource) && (
              <Field label={referringSourceDetailLabel(newPatient.referringSource)!}>
                <input
                  className={inputCls}
                  value={newPatient.referringSourceDetail}
                  onChange={(e) => setNewPatient({ ...newPatient, referringSourceDetail: e.target.value })}
                />
              </Field>
            )}
            <div className="col-span-2 flex gap-2">
              <button
                className={btnPrimary}
                disabled={!newPatient.name.trim()}
                onClick={() => void createPatient()}
              >
                Create patient
              </button>
              <button className={btnSecondary} onClick={() => setCreatingPatient(false)}>
                Back to search
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className={inputCls}
              placeholder="Search by Patient ID or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {(matches ?? []).map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--paper)]"
                onClick={() => {
                  setPatient(p);
                  if (p.primaryCondition) setCondition(p.primaryCondition);
                }}
              >
                <span>{p.name}</span>
                <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
              </button>
            ))}
            {query.trim() && matches?.length === 0 && (
              <p className="text-sm text-[var(--muted)]">No match.</p>
            )}
            <button className={btnSecondary} onClick={() => setCreatingPatient(true)}>
              + New patient
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Visit">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date">
            <input
              type="date"
              className={inputCls}
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
            />
          </Field>
          <Field label="Therapist *">
            <select
              className={inputCls}
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
            >
              <option value="">Select…</option>
              {(therapists ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="col-span-2 flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === 'new'}
                onChange={() => {
                  setMode('new');
                  setBillOverride(null);
                }}
              />
              New service / package
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === 'continuation'}
                disabled={!openPackages?.length}
                onChange={() => {
                  setMode('continuation');
                  setBillOverride(null);
                }}
              />
              Package continuation (₹0){' '}
              {patient && !openPackages?.length && (
                <span className="text-xs text-[var(--muted)]">— no open packages</span>
              )}
            </label>
          </div>

          {mode === 'new' ? (
            <Field label="Service *">
              <select
                className={inputCls}
                value={serviceCatalogId}
                onChange={(e) => {
                  setServiceCatalogId(e.target.value);
                  setBillOverride(null);
                  setAdjustmentReason('');
                }}
              >
                <option value="">Select…</option>
                {categories.map(([category, items]) => (
                  <optgroup key={category} label={category}>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} — {formatINR(i.basePricePaise)}
                        {i.sessionCount > 1 &&
                          ` (${i.sessionCount} sessions, ${formatINR(effectivePricePerSession(i))}/session)`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Open package *">
              <select
                className={inputCls}
                value={openPackageId}
                onChange={(e) => setOpenPackageId(e.target.value)}
              >
                <option value="">Select…</option>
                {(openPackages ?? []).map((p) => (
                  <option key={p.packageGroupId} value={p.packageGroupId}>
                    {p.serviceName} — session {p.logged + 1} of {p.packageTotal} (started{' '}
                    {formatDateDMY(p.startedOn)})
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field
            label={
              mode === 'continuation'
                ? 'Bill amount (₹0 unless topping up)'
                : `Bill amount${selectedService ? ` (catalog: ${formatINR(selectedService.basePricePaise)})` : ''}`
            }
          >
            <RupeeInput valuePaise={billOverride ?? catalogPricePaise} onChange={setBillOverride} />
          </Field>

          {adjustmentPaise !== 0 && (
            <Field
              label={`Adjustment reason * (${adjustmentPaise < 0 ? 'discount' : 'top-up'} of ${formatINR(Math.abs(adjustmentPaise))})`}
            >
              <input
                className={inputCls}
                placeholder="e.g. loyalty discount, added session"
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
              />
            </Field>
          )}

          {billPaise > 0 && (
            <Field label="Payment">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={paymentChoice === 'paid'} onChange={() => setPaymentChoice('paid')} />
                  Paid now
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={paymentChoice === 'pending'}
                    onChange={() => setPaymentChoice('pending')}
                  />
                  Pending — collect later
                </label>
              </div>
              {paymentChoice === 'paid' ? (
                <select
                  className={`${inputCls} mt-2`}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={`${inputCls} mt-2`}
                  placeholder="Optional note — e.g. will pay next Monday"
                  value={pendingNote}
                  onChange={(e) => setPendingNote(e.target.value)}
                />
              )}
            </Field>
          )}

          <Field label="Condition (this visit)">
            <input
              className={inputCls}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            />
          </Field>
          <Field label="Treatment notes">
            <input
              className={inputCls}
              placeholder='e.g. "FM An/Re S,S", "CST Sph Dysfunction"'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
      </SectionCard>

      <ErrorNote message={error} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save visit'}
        </button>
        <button className={btnSecondary} onClick={() => void navigate({ to: '/workspace' })}>
          Cancel
        </button>
      </div>
    </div>
  );
}
