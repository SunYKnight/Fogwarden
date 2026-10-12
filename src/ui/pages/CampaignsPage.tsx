import { PageHeader } from '../kit';
import { CampaignLibrary } from '../library/CampaignLibrary';

export function CampaignsPage({ campaignId }: { campaignId: string | null }) {
  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Campaigns' }]} />
      <div className="page-body">
        <CampaignLibrary selectedId={campaignId} />
      </div>
    </div>
  );
}
