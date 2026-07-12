import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, importVisitsService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import type {
  ImportPreview,
  ImportProgress,
  ImportSummary,
  Resolutions,
  RowResolution,
} from '@/services/importVisitsService';
import { btnPrimary, btnSecondary, ErrorNote, SectionCard, StatTile } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { ImportPreviewTable, allRowsResolved } from './ImportPreviewTable';

type Stage =
  | { kind: 'upload' }
  | { kind: 'preview'; preview: ImportPreview }
  | { kind: 'importing'; progress: ImportProgress }
  | { kind: 'done'; summary: ImportSummary };

export function ImportVisitsPage() {
  const clinic = useClinic();
  const catalogItems = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);

  const [stage, setStage] = useState<Stage>({ kind: 'upload' });
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchResolution(key: string, patch: RowResolution) {
    setResolutions((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const { extractHistoricalRows } = await import('@/services/import/xlsxReader');
      const rawRows = await extractHistoricalRows(file);
      if (rawRows.length === 0) {
        setError('No visit rows found. Expected month tabs named April/May/June with a Date/Patients/MRNO/Service Name/Bill Amount header row.');
        return;
      }
      const preview = await importVisitsService.preview(rawRows, clinic.id);
      setResolutions({});
      setNameOverrides({});
      setStage({ kind: 'preview', preview });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(preview: ImportPreview) {
    setError(null);
    setStage({ kind: 'importing', progress: { done: 0, total: preview.rows.length } });
    try {
      const merged: Resolutions = { ...resolutions };
      for (const row of preview.rows) {
        const override = nameOverrides[row.mrno];
        if (override) merged[row.key] = { ...merged[row.key], patientNameOverride: override };
      }
      const summary = await importVisitsService.commit(preview, merged, clinic.id, (progress) =>
        setStage({ kind: 'importing', progress })
      );
      setStage({ kind: 'done', summary });
    } catch (e) {
      setError(toFriendlyMessage(e));
      setStage({ kind: 'preview', preview });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Import historical visits</h1>
      <p className="text-sm text-[var(--muted)]">
        One-time import of visits logged before go-live in the Excel ledger. Patients are matched
        or created by MRNO; no invoices are generated for imported visits.
      </p>

      {stage.kind === 'upload' && (
        <SectionCard title="Upload the workbook">
          <p className="mb-3 text-xs text-[var(--muted)]">
            Expects the same layout as the Beyond Mechanics / Health Valley sheet: month tabs
            (April, May, June…) with columns Date, Patients, MRNO, A/S, Condition, Therapist,
            Treatment, Service Name, Bill Amount.
          </p>
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
          />
          {busy && <p className="mt-2 text-sm text-[var(--muted)]">Reading workbook…</p>}
          <div className="mt-2">
            <ErrorNote message={error} />
          </div>
        </SectionCard>
      )}

      {stage.kind === 'preview' && (
        <>
          <SectionCard title="Summary">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <StatTile label="Rows parsed" value={stage.preview.summary.totalRows} />
              <StatTile label="Patients" value={stage.preview.summary.distinctPatients} />
              <StatTile label="New patients" value={stage.preview.summary.newPatients} />
              <StatTile label="Packages" value={stage.preview.summary.packagesDetected} />
            </div>
          </SectionCard>

          <ImportPreviewTable
            preview={stage.preview}
            resolutions={resolutions}
            onResolutionChange={patchResolution}
            catalogItems={catalogItems ?? []}
            nameOverrides={nameOverrides}
            onNameOverrideChange={(mrno, name) =>
              setNameOverrides((prev) => ({ ...prev, [mrno]: name }))
            }
          />

          <ErrorNote message={error} />
          <div className="flex gap-2">
            <button
              className={btnPrimary}
              disabled={!allRowsResolved(stage.preview, resolutions)}
              onClick={() => void handleImport(stage.preview)}
            >
              Import {stage.preview.rows.filter((r) => !resolutions[r.key]?.skip).length} visits
            </button>
            <button className={btnSecondary} onClick={() => setStage({ kind: 'upload' })}>
              Start over
            </button>
          </div>
        </>
      )}

      {stage.kind === 'importing' && (
        <SectionCard title="Importing…">
          <p className="text-sm text-[var(--muted)]">
            {stage.progress.done} / {stage.progress.total} visits created
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--paper)]">
            <div
              className="h-full bg-[var(--teal)] transition-all"
              style={{ width: `${(100 * stage.progress.done) / Math.max(1, stage.progress.total)}%` }}
            />
          </div>
        </SectionCard>
      )}

      {stage.kind === 'done' && (
        <SectionCard title="Import complete">
          <ul className="space-y-1 text-sm text-[var(--ink)]">
            <li>{stage.summary.patientsCreated} patients created</li>
            <li>{stage.summary.patientsReused} existing patients reused</li>
            <li>{stage.summary.visitsCreated} visits created</li>
            <li>{stage.summary.rowsSkipped} rows skipped</li>
          </ul>
          <div className="mt-4 flex gap-2">
            <Link to="/archive" className={btnPrimary}>
              Go to Archive
            </Link>
            <Link to="/workspace" className={btnSecondary}>
              Go to Workspace
            </Link>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
