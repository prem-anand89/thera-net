import { useClinic } from '@/app/clinicContext';
import { PrintLetterhead } from '@/features/invoices/printChrome';
import type { Clinic } from '@/domain/types';

export interface LetterheadPreviewProps {
  draft: Pick<Clinic, 'name' | 'address' | 'phone' | 'email' | 'gstNo' | 'partnerHospitalName'>;
  logoUrl: string | null;
  partnerLogoUrl: string | null;
}

export function LetterheadPreview({ draft, logoUrl, partnerLogoUrl }: LetterheadPreviewProps) {
  const realClinic = useClinic();

  // Spread the real clinic to get all required fields, then override with the draft fields
  const previewClinic: Clinic = {
    ...realClinic,
    ...draft,
    name: draft.name || 'Your clinic name',
  };

  return (
    <div className="flex flex-col">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        Invoice preview
      </div>
      <div
        className="pointer-events-none overflow-hidden rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm"
        aria-hidden="true"
      >
        <PrintLetterhead
          clinic={previewClinic}
          logoUrl={logoUrl}
          partnerLogoUrl={partnerLogoUrl}
        />
        
        {/* Faint skeleton below the header to simulate invoice content */}
        <div className="mt-8 space-y-6 opacity-40">
          <div className="flex justify-between">
            <div className="space-y-2">
              <div className="h-2.5 w-24 rounded bg-[var(--border)]" />
              <div className="h-2 w-32 rounded bg-[var(--border)]" />
              <div className="h-2 w-20 rounded bg-[var(--border)]" />
            </div>
            <div className="space-y-2 text-right">
              <div className="ml-auto h-2.5 w-16 rounded bg-[var(--border)]" />
              <div className="ml-auto h-2 w-24 rounded bg-[var(--border)]" />
            </div>
          </div>
          
          <div className="mt-8 rounded-lg border border-[var(--border)]">
            <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
              <div className="flex justify-between">
                <div className="h-2 w-16 rounded bg-[var(--border)]" />
                <div className="h-2 w-12 rounded bg-[var(--border)]" />
              </div>
            </div>
            <div className="px-4 py-4 space-y-3">
              <div className="flex justify-between">
                <div className="h-2 w-40 rounded bg-[var(--border)]" />
                <div className="h-2 w-16 rounded bg-[var(--border)]" />
              </div>
              <div className="flex justify-between">
                <div className="h-2 w-32 rounded bg-[var(--border)]" />
                <div className="h-2 w-16 rounded bg-[var(--border)]" />
              </div>
            </div>
          </div>
          
          <div className="flex justify-end pt-4">
            <div className="h-3 w-32 rounded bg-[var(--border)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
