import { Segmented } from '@/components/ui';
import { ServicesView } from './ServicesView';
import { TreatmentCatalog } from './TreatmentsView';

/** The two lists on the Services & treatments tab. Referral sources live on General ("How patients found you"). */
export type CatalogView = 'packages' | 'treatments';

const CATALOG_VIEWS: { value: CatalogView; label: string }[] = [
  { value: 'packages', label: 'Services' },
  { value: 'treatments', label: 'Treatments' },
];

export function CatalogSection({ view, onViewChange }: { view: CatalogView; onViewChange: (v: CatalogView) => void }) {
  return (
    <div>
      <div className="mb-5">
        <Segmented label="Services or treatments" options={CATALOG_VIEWS} value={view} onChange={onViewChange} />
      </div>
      {view === 'packages' ? <ServicesView /> : <TreatmentCatalog />}
    </div>
  );
}

export { ReferralSourcesCard } from './ReferralSourcesCard';
