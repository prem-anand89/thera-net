import type { Repos } from '@/repositories/types';
import type {
  CatalogItem,
  Clinic,
  Invoice,
  InvoicePayment,
  Patient,
  Payment,
  Settlement,
  Therapist,
  UUID,
  Visit,
} from '@/domain/types';

const BACKUP_VERSION = 1;

export interface BackupBundle {
  version: number;
  exportedAt: string;
  clinicId: UUID;
  clinic: Clinic;
  therapists: Therapist[];
  catalog: CatalogItem[];
  patients: Patient[];
  visits: Visit[];
  invoices: Invoice[];
  invoicePayments: InvoicePayment[];
  payments: Payment[];
  settlements: Settlement[];
}

export interface RestoreSummary {
  therapists: number;
  catalog: number;
  patients: number;
  visits: number;
  invoices: number;
  invoicePayments: number;
  payments: number;
  settlements: number;
}

export function createBackupService(repos: Repos) {
  /** Everything scoped to one clinic, bundled for a downloadable backup. */
  async function exportBundle(clinicId: UUID): Promise<BackupBundle> {
    const [clinic, therapists, catalog, patients, visits, invoices, invoicePayments, payments, settlements] =
      await Promise.all([
        repos.clinics.get(clinicId),
        repos.therapists.list(clinicId, true),
        repos.catalog.list(clinicId, true),
        repos.patients.list(clinicId),
        repos.visits.list({ clinicId }),
        repos.invoices.list(clinicId),
        repos.invoicePayments.list(clinicId),
        repos.payments.list(clinicId),
        repos.settlements.list(clinicId),
      ]);
    if (!clinic) throw new Error('Clinic not found');

    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      clinicId,
      clinic,
      therapists,
      catalog,
      patients,
      visits,
      invoices,
      invoicePayments,
      payments,
      settlements,
    };
  }

  return {
    exportBundle,

    /** Triggers a browser download of the export as a JSON file. */
    async downloadBackup(clinicId: UUID, clinicName: string): Promise<void> {
      const bundle = await exportBundle(clinicId);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${clinicName.replace(/[^a-z0-9]+/gi, '-')}-backup-${bundle.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    /**
     * Restores a bundle exported from THIS SAME clinic. Refuses a bundle
     * from a different clinic — this is a backup/restore safety net, not a
     * cross-clinic data-migration tool (invoice numbering is tied to a
     * server-side sequence per clinic; blindly replaying another clinic's
     * invoice rows here would corrupt that).
     *
     * Writes go through repos.*.put() (queues the outbox, so restored rows
     * sync back up) for every client-writable table. Invoices are
     * server-issued and read-only from the client, so they're restored via
     * putLocal (local cache only) — if Supabase still has them, the normal
     * pull sync repopulates this anyway; this only matters for getting the
     * local cache usable again before that next sync.
     */
    async restoreBundle(bundle: BackupBundle, currentClinicId: UUID): Promise<RestoreSummary> {
      if (bundle.version !== BACKUP_VERSION) {
        throw new Error(`Unsupported backup version ${bundle.version} (expected ${BACKUP_VERSION}).`);
      }
      if (bundle.clinicId !== currentClinicId) {
        throw new Error('This backup was exported from a different clinic — restore is only supported into the same clinic it came from.');
      }

      await Promise.all([
        ...bundle.therapists.map((t) => repos.therapists.put(t)),
        ...bundle.catalog.map((c) => repos.catalog.put(c)),
        ...bundle.patients.map((p) => repos.patients.put(p)),
        ...bundle.visits.map((v) => repos.visits.put(v)),
        ...bundle.invoices.map((inv) => repos.invoices.putLocal(inv)),
        ...bundle.invoicePayments.map((p) => repos.invoicePayments.put(p)),
        ...bundle.payments.map((p) => repos.payments.put(p)),
        ...bundle.settlements.map((s) => repos.settlements.put(s)),
      ]);

      return {
        therapists: bundle.therapists.length,
        catalog: bundle.catalog.length,
        patients: bundle.patients.length,
        visits: bundle.visits.length,
        invoices: bundle.invoices.length,
        invoicePayments: bundle.invoicePayments.length,
        payments: bundle.payments.length,
        settlements: bundle.settlements.length,
      };
    },
  };
}
