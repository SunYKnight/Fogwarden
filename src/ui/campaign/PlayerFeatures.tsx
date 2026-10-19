import { SHEET_EDIT_MODES, type PlayerFeatures, type SheetEditMode } from '@/core/model';
import { CheckboxField, SelectField } from '../components/fields';
import { Section } from '../kit';

type Switch = Exclude<keyof PlayerFeatures, 'sheetEdits'>;

/** The campaign's player switches, in the order shown; a new switch adds its line here. */
const PLAYER_FEATURES: { key: Switch; label: string; hint: string }[] = [
  {
    key: 'sheets',
    label: 'Players see their full character sheet',
    hint: 'Skills, spells, inventory and features on their own link.',
  },
  {
    key: 'uploads',
    label: 'Players may send pictures',
    hint: 'PNG, JPEG or WebP up to 10 MB from their own link. You review each one under Players; nobody else sees it.',
  },
  {
    key: 'chat',
    label: 'Players may chat',
    hint: 'With everyone or as a whisper to you. You read every line in the Chat tab next to the log.',
  },
  {
    key: 'sharedRolls',
    label: 'Players may share rolls',
    hint: "A shared roll shows on every character's link and in the chat; other rolls stay between you and them.",
  },
  {
    key: 'playerNotes',
    label: 'Players keep notes',
    hint: 'Saved with the campaign. You can read them on the Party tab; other players never see them.',
  },
];

const SHEET_EDIT_LABELS: Record<SheetEditMode, string> = {
  off: 'Never',
  auto: 'At once',
  approve: 'After you accept',
};

/**
 * What players get on their own links (LAN and online), all off by default so a table group sees no change. The
 * party view never shows any of it.
 */
export function PlayerFeaturesSection(props: {
  features: PlayerFeatures;
  onChange: (patch: Partial<PlayerFeatures>) => void;
}) {
  const { features, onChange } = props;
  const anyOn = PLAYER_FEATURES.some(({ key }) => features[key]) || features.sheetEdits !== 'off';
  return (
    <Section title="On players' own links" collapsible defaultOpen={anyOn}>
      <div className="col">
        {PLAYER_FEATURES.map(({ key, label, hint }) => (
          <div key={key}>
            <CheckboxField label={label} value={features[key]} onChange={(on) => onChange({ [key]: on })} />
            <p className="muted small">{hint}</p>
          </div>
        ))}
        <div>
          <SelectField
            label="Players change HP, slots and items"
            value={features.sheetEdits}
            options={SHEET_EDIT_MODES}
            format={(mode) => SHEET_EDIT_LABELS[mode]}
            onChange={(sheetEdits) => onChange({ sheetEdits })}
          />
          <p className="muted small">
            HP, temporary HP, spell slots, death saves and hit dice; with full sheets also item counts and coins. Each
            change is logged and can be undone.
          </p>
        </div>
      </div>
    </Section>
  );
}
