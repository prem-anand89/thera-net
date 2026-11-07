import { CopyAddressButton } from '@/components/CopyAddressButton';
import { homeCareOn } from '@/domain/careLocations';

/** The patient's home address with a Copy button; only for a clinic that does home visits and only when one is on file. */
export function PatientAddressLine({
  clinic,
  address,
}: {
  clinic: { careLocations?: readonly string[] | null };
  address: string | null | undefined;
}) {
  if (!homeCareOn(clinic) || !address?.trim()) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1 text-sm">
      <p className="line-clamp-2 min-w-0 max-w-prose whitespace-pre-line text-[var(--ink)]">{address}</p>
      <CopyAddressButton address={address} />
    </div>
  );
}
