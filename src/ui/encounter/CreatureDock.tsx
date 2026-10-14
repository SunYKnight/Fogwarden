import { useState } from 'react';
import { CONDITIONS, type Combatant, type CreatureAction, type Encounter } from '@/core/model';
import { SIDE_COLORS } from '@/render/tokens/tokenMaterials';
import { useAppStore } from '@/state/appStore';
import { currentCombatant, movedThisTurnFt } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { Button, Popover, Tabs, type TabSpec } from '../kit';
import { changeHp, rollAction, rollInitiativeFor, stepTurn, toggleCondition } from './combatantCommands';
import { useCreature, useHeldPackOf } from './creatureLookup';
import { ActionsTab, EffectsTab, NotesTab, StatsTab, TokenTab } from './DockTabs';
import { useEncounterUi, type DockTab, type HpChange } from './encounterUiStore';
import { HpBar } from './HpBar';
import { UnplacedChip } from './UnplacedChip';

/** Active conditions as chips (click removes); the picker holds all of them. */
function ConditionPicker({ c }: { c: Combatant }) {
  return (
    <div className="chips">
      {c.conditions.map((cond) => (
        <button
          key={cond}
          type="button"
          className="chip active"
          title={`Remove ${cond}`}
          onClick={() => toggleCondition(c.id, cond)}
        >
          {cond}
        </button>
      ))}
      <Popover
        label="Conditions"
        trigger={(open, toggle) => <Button icon="plus" label="Condition" active={open} onClick={toggle} />}
      >
        <div className="chips condition-popover">
          {CONDITIONS.map((cond) => (
            <button
              key={cond}
              type="button"
              aria-pressed={c.conditions.includes(cond)}
              className={c.conditions.includes(cond) ? 'chip active' : 'chip'}
              onClick={() => toggleCondition(c.id, cond)}
            >
              {cond}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function DockName({ c }: { c: Combatant }) {
  return (
    <span className="dock-name" title={c.name}>
      <span className="side-bar" style={{ background: SIDE_COLORS[c.side] }} />
      <strong>{c.name}</strong>
    </span>
  );
}

function HpReadout({ c }: { c: Combatant }) {
  return (
    <span className="hp">
      HP {c.hp.current} / {c.hp.max}
      {c.hp.temp > 0 && <span className="muted"> + {c.hp.temp} temp</span>}
    </span>
  );
}

interface AmountProps {
  amount: string;
  setAmount: (amount: string) => void;
}

interface SummaryProps extends AmountProps {
  c: Combatant;
  /** Grid distance moved since its turn began; null when it isn't its turn. */
  moved: number | null;
  walk: number | undefined;
}

/** Always visible part of the dock: who it is, hit points, quick damage and healing, conditions. */
function CreatureSummary({ c, moved, walk, amount, setAmount }: SummaryProps) {
  const value = Math.round(Number(amount));
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0;

  const apply = (change: HpChange) => {
    if (valid) {
      changeHp(c.id, change, value);
      setAmount('');
    }
  };

  return (
    <div className="dock-summary">
      <div className="row">
        <DockName c={c} />
        <div className="spacer" />
        <span className="muted">AC {c.armorClass}</span>
      </div>
      <div className="row">
        <strong>
          <HpReadout c={c} />
        </strong>
        <div className="spacer" />
        {moved !== null && (
          <span className="muted small" title="Grid distance from where this turn began">
            Moved {moved}
            {walk !== undefined ? ` / ${walk}` : ''} ft
          </span>
        )}
      </div>
      <HpBar hp={c.hp} />
      <div className="row">
        <input
          type="number"
          min={1}
          placeholder="Amount"
          aria-label={`Hit points for ${c.name}`}
          value={amount}
          className="grow"
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply('damage');
          }}
        />
        <Button
          icon="minus"
          label="Damage"
          iconOnly
          variant="danger"
          disabled={!valid}
          onClick={() => apply('damage')}
        />
        <Button icon="plus" label="Heal" iconOnly disabled={!valid} onClick={() => apply('heal')} />
        <Button label="Temp" disabled={!valid} onClick={() => apply('temp')} />
      </div>
      <ConditionPicker c={c} />
    </div>
  );
}

interface CreatureViewProps extends AmountProps {
  c: Combatant;
  hasMap: boolean;
  isCurrent: boolean;
  result: string | null;
  setResult: (result: string) => void;
}

function CreatureView({ c, hasMap, isCurrent, amount, setAmount, result, setResult }: CreatureViewProps) {
  const reportError = useAppStore((s) => s.reportError);
  const rule = useAppStore((s) => s.settings?.diagonalRule ?? '5-5-5');
  const rollMode = useEncounterUi((s) => s.rollMode);
  const tab = useEncounterUi((s) => s.dockTab);
  const encounter = useEncounterStore((s) => s.encounter);
  const grid = useEncounterStore((s) => s.map?.grid);
  const creature = useCreature(c.creature);
  const heldPack = useHeldPackOf(c.creature);
  const moved = isCurrent && encounter && grid ? movedThisTurnFt(encounter, grid, rule) : null;

  // Library dice formulas may not parse; the damage waits for the target.
  const attack = (action: CreatureAction) => {
    try {
      const rolled = rollAction(c, action, rollMode);
      if (rolled) {
        setResult(rolled.text);
        setAmount(String(rolled.damage.reduce((sum, d) => sum + d.total, 0)));
      }
    } catch (error) {
      reportError(error);
    }
  };

  const tabs: TabSpec<DockTab>[] = [
    { id: 'actions', label: 'Actions', icon: 'swords' },
    {
      id: 'effects',
      label: 'Effects',
      icon: 'clock',
      badge: c.effects.length > 0 ? String(c.effects.length) : undefined,
    },
    { id: 'token', label: 'Token', icon: 'user' },
    { id: 'stats', label: 'Stats', icon: 'book' },
    { id: 'notes', label: 'Notes', icon: 'journal' },
  ];

  return (
    <>
      <CreatureSummary c={c} moved={moved} walk={creature?.speeds.walk} amount={amount} setAmount={setAmount} />
      <div className="dock-main">
        <Tabs tabs={tabs} value={tab} onChange={(id) => useEncounterUi.setState({ dockTab: id })} label="Creature" />
        <div className="dock-body" role="tabpanel">
          {tab === 'actions' && <ActionsTab c={c} creature={creature} result={result} attack={attack} />}
          {tab === 'effects' && <EffectsTab c={c} />}
          {tab === 'token' && <TokenTab c={c} hasMap={hasMap} />}
          {tab === 'stats' && (
            <StatsTab c={c} creature={creature} heldPack={heldPack} result={result} attack={attack} />
          )}
          {tab === 'notes' && <NotesTab c={c} />}
        </div>
      </div>
    </>
  );
}

/** Nothing to show: set-up actions before the fight, a hint otherwise. */
function EmptyDock({ encounter, hasMap }: { encounter: Encounter; hasMap: boolean }) {
  const empty = encounter.combatants.length === 0;
  return (
    <div className="dock-empty">
      <p className="muted">
        {empty
          ? 'Add creatures and player characters to start.'
          : 'Select a creature on the map or in the initiative list to see it here.'}
      </p>
      {encounter.round === 0 && (
        <div className="row wrap">
          {hasMap && <UnplacedChip />}
          <Button
            icon="dice"
            label="Roll initiative"
            disabled={empty}
            title="Roll initiative for everyone and sort the order"
            onClick={() => rollInitiativeFor(null)}
          />
          <Button icon="next" label="Start combat" shortcut="Space" disabled={empty} onClick={() => stepTurn('next')} />
        </div>
      )}
    </div>
  );
}

interface ContentProps {
  encounter: Encounter;
  hasMap: boolean;
  shown: Combatant | null;
  current: Combatant | null;
  collapsed: boolean;
}

/** Holds the amount and the last attack across selections, so a rolled damage can go to the target. */
function DockContent({ encounter, hasMap, shown, current, collapsed }: ContentProps) {
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<string | null>(null);
  return collapsed ? (
    <div className="dock-bar">
      {shown ? (
        <>
          <DockName c={shown} />
          <HpReadout c={shown} />
          <span className="muted">AC {shown.armorClass}</span>
        </>
      ) : (
        <span className="muted">No creature selected</span>
      )}
    </div>
  ) : shown ? (
    <CreatureView
      c={shown}
      hasMap={hasMap}
      isCurrent={shown.id === current?.id}
      amount={amount}
      setAmount={setAmount}
      result={result}
      setResult={setResult}
    />
  ) : (
    <EmptyDock encounter={encounter} hasMap={hasMap} />
  );
}

/**
 * Bottom of Play under the map: the selected creature, else the one whose turn it is, with hit points and
 * conditions on the left and its actions, effects, token, stats and notes as tabs.
 */
export function CreatureDock({ encounter, hasMap }: { encounter: Encounter; hasMap: boolean }) {
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  const collapsed = useEncounterUi((s) => s.dockCollapsed);
  const current = currentCombatant(encounter);
  const shown = encounter.combatants.find((c) => c.id === selectedId) ?? current;
  return (
    <section className={collapsed ? 'creature-dock collapsed' : 'creature-dock'} aria-label="Creature">
      <DockContent
        key={current?.id ?? 'setup'}
        encounter={encounter}
        hasMap={hasMap}
        shown={shown}
        current={current}
        collapsed={collapsed}
      />
      <Button
        className="dock-collapse"
        icon={collapsed ? 'chevronUp' : 'chevronDown'}
        label={collapsed ? 'Show the creature dock' : 'Hide the creature dock for more map'}
        iconOnly
        variant="ghost"
        onClick={() => useEncounterUi.setState({ dockCollapsed: !collapsed })}
      />
    </section>
  );
}
