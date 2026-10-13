import type { Encounter } from '@/core/model';
import { useDmCameraStore } from '@/sync/cameraStore';
import { usePlayerViewStore } from '@/sync/playerViewStore';
import { CheckboxField } from '../components/fields';
import { Section } from '../kit';
import { ScenePanel } from '../sound/SceneMenu';
import { SoundPanel } from '../sound/SoundMenu';
import { PlayerMovesToggle } from './PlayerMovesToggle';
import { ShowPanel } from './ShowMenu';

/** Table tab: what the players see and hear, beside the map itself. */
export function TableTab({ encounter }: { encounter: Encounter }) {
  const push = useDmCameraStore((s) => s.push);
  const setPush = useDmCameraStore((s) => s.setPush);
  const showTurnOrder = usePlayerViewStore((s) => s.showTurnOrder);
  return (
    <div className="col table-tab">
      <Section title="Players" collapsible>
        <PlayerMovesToggle allowed={encounter.playersMoveTokens} />
        <CheckboxField label="Push my camera to players" value={push} onChange={setPush} />
        <CheckboxField
          label="Show turn order to players"
          value={showTurnOrder}
          onChange={(v) => usePlayerViewStore.setState({ showTurnOrder: v })}
        />
      </Section>
      <Section title="Sound" collapsible>
        <SoundPanel />
      </Section>
      <Section title="Show to players" collapsible>
        <ShowPanel campaignId={encounter.campaignId} />
      </Section>
      <Section title="Scene" collapsible>
        <ScenePanel />
      </Section>
    </div>
  );
}
