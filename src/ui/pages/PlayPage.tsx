import { useAppStore } from '@/state/appStore';
import { EncounterPage } from '../encounter/EncounterPage';
import { Button, EmptyState } from '../kit';
import { openNewEncounter } from '../library/compendiumUi';

/** The running encounter; without one, points to where encounters are started. */
export function PlayPage() {
  const locator = useAppStore((s) => s.settings?.lastEncounter ?? null);
  const navigate = useAppStore((s) => s.navigate);
  return locator ? (
    <EncounterPage key={locator.encounterId} campaignId={locator.campaignId} encounterId={locator.encounterId} />
  ) : (
    <div className="page-frame">
      <EmptyState
        icon="swords"
        title="No encounter running"
        action={
          <div className="row">
            <Button icon="plus" label="New encounter" variant="primary" onClick={() => openNewEncounter(null)} />
            <Button
              icon="swords"
              label="Go to campaigns"
              onClick={() => navigate({ page: 'campaigns', campaignId: null })}
            />
          </div>
        }
      >
        Start or resume an encounter from a campaign; it then stays here while you look things up elsewhere.
      </EmptyState>
    </div>
  );
}
