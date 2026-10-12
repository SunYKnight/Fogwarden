import type { Settings } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { CheckboxField, NumberField, SelectField, SliderField } from '../components/fields';
import { PageHeader, Section } from '../kit';
import { AboutSection } from './AboutSection';
import { DataSection } from './DataSection';
import { PlayerViewSection } from './PlayerViewSection';

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const reportError = useAppStore((s) => s.reportError);
  const save = (next: Settings) => setSettings(next).catch(reportError);

  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Settings' }]} />
      <div className="page-body">
        {settings ? (
          <div className="settings-page">
            <DataSection />
            <PlayerViewSection settings={settings} save={save} />
            <Section title="LAN">
              <NumberField
                label="Port"
                value={settings.lan.port}
                min={1024}
                max={65535}
                title="Applies the next time the LAN server starts"
                onChange={(port) => save({ ...settings, lan: { port } })}
              />
            </Section>
            <Section title="Audio">
              <SliderField
                label="Volume (everyone)"
                value={Math.round(settings.audio.volume * 100)}
                min={0}
                max={100}
                step={5}
                suffix="%"
                onChange={(v) => save({ ...settings, audio: { ...settings.audio, volume: v / 100 } })}
              />
              <SliderField
                label="This window"
                value={Math.round(settings.audio.dmVolume * 100)}
                min={0}
                max={100}
                step={5}
                suffix="%"
                onChange={(v) => save({ ...settings, audio: { ...settings.audio, dmVolume: v / 100 } })}
              />
            </Section>
            <Section title="Rules">
              <SelectField
                label="Diagonals"
                value={settings.diagonalRule}
                options={['5-5-5', '5-10-5'] as const}
                format={(v) => (v === '5-5-5' ? 'Every diagonal 5 ft (PHB)' : 'Alternate 5/10 ft (DMG variant)')}
                onChange={(v) => save({ ...settings, diagonalRule: v })}
              />
              <CheckboxField
                label="Standees in the 3D view (DM and players)"
                value={settings.tokenStandees}
                onChange={(tokenStandees) => save({ ...settings, tokenStandees })}
              />
            </Section>
            <AboutSection settings={settings} save={save} />
          </div>
        ) : (
          <div className="waiting">Loading settings…</div>
        )}
      </div>
    </div>
  );
}
