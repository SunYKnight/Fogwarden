import type { Settings } from '@/core/model';
import { NumberField } from '../components/fields';
import { Section } from '../kit';
import { ONLINE_PLAY_AVAILABLE, OnlineSection } from '../server/OnlineSection';
import { LanControls } from '../shell/LanControls';
import { PlayerViewSection } from './PlayerViewSection';

/** Settings > Players: the three ways players see the game, from the same room to anywhere. */
export function PlayersSection({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
  return (
    <>
      <PlayerViewSection settings={settings} save={save} />
      <Section title="LAN">
        <LanControls />
        <Section title="Advanced" collapsible defaultOpen={false}>
          <NumberField
            label="Port"
            value={settings.lan.port}
            min={1024}
            max={65535}
            title="Applies the next time the LAN server starts"
            onChange={(port) => save({ ...settings, lan: { port } })}
          />
        </Section>
      </Section>
      {ONLINE_PLAY_AVAILABLE && <OnlineSection remote={settings.remote} />}
    </>
  );
}
