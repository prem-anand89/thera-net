import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { clinicBillingConfig, type Therapist, type Visit } from '@/domain/types';
import { useClinic } from '@/app/clinicContext';
import { RevenueShareEditor } from './RevenueShareEditor';

/** Loads a visit's lines and shares, then shows the share editor. Used wherever a row has "Edit split". */
export function RevenueShareEditorLoader({
  visit,
  therapists,
  onClose,
}: {
  visit: Visit;
  therapists: Therapist[];
  onClose: () => void;
}) {
  const clinic = useClinic();
  const items = useLiveQuery(() => repos.visitItems.listByVisitIds([visit.id]), [visit.id]);
  const credits = useLiveQuery(() => repos.visitCredits.listByVisitIds([visit.id]), [visit.id]);
  if (!items || !credits) return null;
  return (
    <RevenueShareEditor
      visit={visit}
      items={items}
      credits={credits}
      therapists={therapists}
      splitEnabled={clinicBillingConfig(clinic).therapistSplit}
      onClose={onClose}
    />
  );
}
