import { CampaignDetail, CampaignList } from '../library/CampaignLibrary';

export function CampaignsPage({ campaignId }: { campaignId: string | null }) {
  return campaignId ? <CampaignDetail key={campaignId} campaignId={campaignId} /> : <CampaignList />;
}
