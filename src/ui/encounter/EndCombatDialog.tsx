import { useState } from 'react';
import type { Encounter } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { combatXp, describeXp } from '@/state/combatRules';
import { useLibraryStore } from '@/state/libraryStore';
import { rollTable, useRandomTables } from '@/state/randomTables';
import { Button, Dialog, Section } from '../kit';
import { endCombat } from './combatantCommands';
import { useEncounterUi } from './encounterUiStore';

// Module-level so the dialog's focus effect, keyed on `onClose`, runs once.
const close = () => useEncounterUi.setState({ endCombatOpen: false });

function LootPicker({ onAdd }: { onAdd: (line: string) => void }) {
  const reportError = useAppStore((s) => s.reportError);
  const tables = useRandomTables();
  const [text, setText] = useState('');
  const [tableId, setTableId] = useState('');
  const chosen = tables.find((t) => t.id === tableId) ?? tables[0];

  const addText = () => {
    onAdd(text.trim());
    setText('');
  };

  // Tables are user files; a broken reference or empty table throws.
  const roll = () => {
    try {
      const rolled = chosen && rollTable(chosen.id);
      if (rolled) onAdd(`${rolled.text} (${rolled.tableName}, ${rolled.detail})`);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="col">
      <div className="row">
        <input
          className="grow"
          placeholder="50 gp, potion of healing…"
          aria-label="Loot"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim() !== '') addText();
          }}
        />
        <Button icon="plus" label="Add" disabled={text.trim() === ''} onClick={addText} />
      </div>
      {tables.length > 0 ? (
        <div className="row">
          <select
            className="grow"
            aria-label="Random table"
            value={chosen?.id ?? ''}
            onChange={(e) => setTableId(e.target.value)}
          >
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button icon="dice" label="Roll on table" onClick={roll} />
        </div>
      ) : (
        <span className="muted small">Random tables from the Compendium can roll loot here.</span>
      )}
    </div>
  );
}

/** End combat: XP of the defeated enemies split among the player characters, and the loot, into the log. */
export function EndCombatDialog({ encounter }: { encounter: Encounter }) {
  const notify = useAppStore((s) => s.notify);
  const entries = useLibraryStore((s) => s.listings.creature.entries);
  const [loot, setLoot] = useState<string[]>([]);
  const award = combatXp(encounter, (c) => entries.find((e) => e.ref.id === c.creature?.id)?.doc.xp ?? 0);
  const xpLine = award.total > 0 ? describeXp(award) : null;

  const finish = () => {
    endCombat(xpLine, loot);
    notify(xpLine ? `Combat ended. ${xpLine}` : 'Combat ended');
    close();
  };

  return (
    <Dialog
      title="End combat"
      onClose={close}
      width={480}
      footer={
        <>
          <Button label="Cancel" onClick={close} />
          <Button icon="check" label="End combat" variant="primary" onClick={finish} />
        </>
      }
    >
      <div className="col">
        <Section title="Experience">
          {award.defeated.length > 0 ? (
            <p className="end-combat-xp">
              <strong>{award.total} XP</strong> from {award.defeated.join(', ')}
              <br />
              {award.characters.length > 0 ? (
                <>
                  <strong>{award.share} XP each</strong> for {award.characters.join(', ')}
                </>
              ) : (
                <span className="muted">No player characters to share it.</span>
              )}
            </p>
          ) : (
            <p className="muted">No enemy is down, so nobody earns XP.</p>
          )}
        </Section>
        <Section title={`Loot (${loot.length})`}>
          <ul className="end-combat-loot">
            {loot.map((line, i) => (
              <li key={`${i}-${line}`} className="row">
                <span className="grow">{line}</span>
                <Button
                  icon="close"
                  label={`Remove ${line}`}
                  iconOnly
                  variant="ghost"
                  onClick={() => setLoot(loot.filter((_, j) => j !== i))}
                />
              </li>
            ))}
          </ul>
          <LootPicker onAdd={(line) => setLoot([...loot, line])} />
        </Section>
        <p className="muted small">XP and loot go to the log and the session journal.</p>
      </div>
    </Dialog>
  );
}
