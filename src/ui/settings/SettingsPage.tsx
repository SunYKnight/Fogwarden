import type { ComponentType } from 'react';
import type { Settings } from '@/core/model';
import { useAppStore, type SettingsSection } from '@/state/appStore';
import { CheckboxField, SelectField, SliderField } from '../components/fields';
import { Icon, PageHeader, Section } from '../kit';
import { PackActions, PackLibrary } from '../library/PackLibrary';
import { AboutSection } from './AboutSection';
import { DataSection } from './DataSection';
import { GraphicsSection } from './GraphicsSection';
import { PlayersSection } from './PlayersSection';
import { SETTINGS_SECTIONS } from './sections';

interface SectionProps {
  settings: Settings;
  save: (s: Settings) => void;
}

function AudioSection({ settings, save }: SectionProps) {
  return (
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
  );
}

function RulesSection({ settings, save }: SectionProps) {
  return (
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
  );
}

function ContentSection() {
  return (
    <Section title="Content packs" actions={<PackActions />}>
      <PackLibrary />
    </Section>
  );
}

const SECTION_BODIES: Record<SettingsSection, ComponentType<SectionProps>> = {
  data: DataSection,
  players: PlayersSection,
  graphics: GraphicsSection,
  audio: AudioSection,
  rules: RulesSection,
  content: ContentSection,
  about: AboutSection,
};

/** One settings section at a time, picked in the sub-navigation on the left. */
export function SettingsPage({ section }: { section: SettingsSection }) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const reportError = useAppStore((s) => s.reportError);
  const navigate = useAppStore((s) => s.navigate);
  const save = (next: Settings) => setSettings(next).catch(reportError);
  const current = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0]!;
  const Body = SECTION_BODIES[current.id];

  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Settings' }, { label: current.label }]} />
      <div className="page-body settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === current.id ? 'settings-nav-item active' : 'settings-nav-item'}
              aria-current={s.id === current.id ? 'page' : undefined}
              onClick={() => navigate({ page: 'settings', section: s.id })}
            >
              {s.icon && <Icon name={s.icon} size={16} />}
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        {settings ? (
          <div className={current.id === 'content' ? 'settings-page settings-wide' : 'settings-page'}>
            <Body settings={settings} save={save} />
          </div>
        ) : (
          <div className="waiting">Loading settings…</div>
        )}
      </div>
    </div>
  );
}
