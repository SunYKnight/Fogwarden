import {
  newId,
  sheetEditTarget,
  type CharacterSheet,
  type Combatant,
  type Creature,
  type Encounter,
  type PlayerFeatures,
  type PlayerSheetOverlay,
  type SheetEdit,
} from '@/core/model';
import { sheetFromCreature } from '@/core/rules/characterSheet';
import { creatureResources } from '@/core/rules/resources';
import { useAppStore } from '@/state/appStore';
import { settleHpChange } from '@/state/combatRules';
import { addLog } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { findCreature } from '@/ui/encounter/creatureLookup';
import { queueConcentrationChecks } from '@/ui/encounter/encounterUiStore';
import { queueSheetEdit, sendPlayerNotice, storePlayerSheet, takeSheetEdit, usePlayerDataStore } from './playerData';
import { ownCharacter } from './playerFilter';
import type { CharacterDetails, PlayerRequest, SyncPayload } from './protocol';
import { useViewLinksStore } from './views';

/** Temporary hit points beyond any spell or feature; a typo should not stick. */
export const TEMP_HP_MAX = 999;

// Why an edit to the value the character already has is refused.
const UNCHANGED = 'nothing changes';

/** What a sheet edit is checked against. */
export interface SheetEditContext {
  encounter: Encounter;
  features: PlayerFeatures;
  creature: Creature | null;
  /** The library sheet without the player's changes; null without a library creature or while sheets are off. */
  sheet: CharacterSheet | null;
  /** The player's stored changes; null until loaded. */
  overlay: PlayerSheetOverlay | null;
}

export type SheetEditCheck = { combatant: Combatant; text: string; before: string } | { refused: string };

type SheetEditRequest = Extract<PlayerRequest, { type: 'sheetEdit' }>;

/** The library sheet with the player's changes; an item change counts only while the item keeps its name. */
export function applySheetOverlay(sheet: CharacterSheet, overlay: PlayerSheetOverlay): CharacterSheet {
  return {
    ...sheet,
    inventory: sheet.inventory.map((item, index) => {
      const changed = overlay.inventory[String(index)];
      return changed?.name === item.name ? { ...item, quantity: changed.quantity, equipped: changed.equipped } : item;
    }),
    currency: { ...sheet.currency, ...overlay.currency },
  };
}

/** The full sheet content with the player's changes: what the player sees and the DM's sheet shows. */
export function detailsWithOverlay(details: CharacterDetails, overlay: PlayerSheetOverlay): CharacterDetails {
  return { ...details, sheet: applySheetOverlay(details.sheet, overlay) };
}

interface FieldCheck {
  before: unknown;
  after: unknown;
  refused: string | null;
  /** E.g. "HP 12 → 7". */
  change: string;
}

/** Why inventory and coins cannot change now; null when they can. */
function inventoryRefusal(ctx: SheetEditContext): string | null {
  return !ctx.features.sheets
    ? 'players do not see their full sheet'
    : !ctx.sheet
      ? 'the character has no library sheet'
      : !ctx.overlay
        ? 'the sheet is still loading'
        : null;
}

function checkField(ctx: SheetEditContext, c: Combatant, edit: SheetEdit): FieldCheck {
  const sheet = ctx.sheet && ctx.overlay ? applySheetOverlay(ctx.sheet, ctx.overlay) : null;
  const item = 'index' in edit ? sheet?.inventory[edit.index] : undefined;
  let check: FieldCheck;
  switch (edit.field) {
    case 'hp':
      check = {
        before: c.hp.current,
        after: edit.value,
        refused: edit.value > c.hp.max ? `HP above the maximum of ${c.hp.max}` : null,
        change: `HP ${c.hp.current} → ${edit.value}`,
      };
      break;
    case 'tempHp':
      check = {
        before: c.hp.temp,
        after: edit.value,
        refused: edit.value > TEMP_HP_MAX ? `temporary HP above ${TEMP_HP_MAX}` : null,
        change: `temporary HP ${c.hp.temp} → ${edit.value}`,
      };
      break;
    case 'slotsUsed': {
      const level = String(edit.level);
      const max = ctx.creature ? creatureResources(ctx.creature).slots[level] : undefined;
      const used = c.resources.slotsUsed[level] ?? 0;
      check = {
        before: used,
        after: edit.value,
        refused:
          max === undefined
            ? `the character has no level ${level} slots`
            : edit.value > max
              ? `only ${max} level ${level} slots`
              : null,
        change: `level ${level} slots used ${used} → ${edit.value}`,
      };
      break;
    }
    case 'hitDiceUsed': {
      const used = ctx.overlay?.hitDiceUsed ?? 0;
      check = {
        before: used,
        after: edit.value,
        refused: !ctx.overlay
          ? 'the sheet is still loading'
          : c.level === null
            ? 'the character level is unknown'
            : edit.value > c.level
              ? `only ${c.level} hit dice`
              : null,
        change: `hit dice used ${used} → ${edit.value}`,
      };
      break;
    }
    case 'deathSaves': {
      const { successes, failures } = c.deathSaves;
      check = {
        before: { successes, failures },
        after: { successes: edit.successes, failures: edit.failures },
        refused: c.hp.current > 0 ? 'death saves only count at 0 HP' : null,
        change: `death saves ${successes}/${failures} → ${edit.successes}/${edit.failures} (successes/failures)`,
      };
      break;
    }
    case 'itemQuantity':
      check = {
        before: item?.quantity,
        after: edit.value,
        refused: inventoryRefusal(ctx) ?? (item ? null : 'no such item'),
        change: `${item?.name ?? 'item'} ×${item?.quantity ?? 0} → ×${edit.value}`,
      };
      break;
    case 'itemEquipped':
      check = {
        before: item?.equipped,
        after: edit.value,
        refused: inventoryRefusal(ctx) ?? (item ? null : 'no such item'),
        change: `${edit.value ? 'equips' : 'unequips'} ${item?.name ?? 'item'}`,
      };
      break;
    case 'currency': {
      const coins = sheet?.currency[edit.coin] ?? 0;
      check = {
        before: coins,
        after: edit.value,
        refused: inventoryRefusal(ctx),
        change: `${edit.coin} ${coins} → ${edit.value}`,
      };
      break;
    }
  }
  return check;
}

/**
 * A player's sheet edit, checked like a DM edit: only while the campaign allows sheet edits, only the view's
 * own character in the open encounter, each value inside its rule range. `before` is the current value, so an
 * edit accepted later can tell whether the DM changed the value meanwhile.
 */
export function checkSheetEdit(ctx: SheetEditContext, view: string, request: SheetEditRequest): SheetEditCheck {
  const own = ownCharacter(ctx.encounter, view);
  const refusals: [boolean, string][] = [
    [ctx.features.sheetEdits === 'off', 'players may not change their sheets'],
    [request.combatantId !== view, 'that sheet belongs to another view'],
    [!own, 'the character is not in this encounter'],
  ];
  const refused = refusals.find(([fails]) => fails)?.[1];
  let check: SheetEditCheck = { refused: refused ?? 'the edit is not possible' };
  if (refused === undefined && own) {
    const field = checkField(ctx, own, request.edit);
    const before = JSON.stringify(field.before);
    const unchanged = before === JSON.stringify(field.after) ? UNCHANGED : null;
    const fieldRefused = field.refused ?? unchanged;
    check =
      fieldRefused === null
        ? { combatant: own, text: `${own.name}: ${field.change}`, before }
        : { refused: fieldRefused };
  }
  return check;
}

/** The player's stored changes after `edit`; null for values the encounter holds. */
export function overlayAfter(ctx: SheetEditContext, edit: SheetEdit): PlayerSheetOverlay | null {
  const overlay = ctx.overlay;
  const sheet = ctx.sheet && overlay ? applySheetOverlay(ctx.sheet, overlay) : null;
  let next: PlayerSheetOverlay | null | undefined = null;
  if (edit.field === 'itemQuantity' || edit.field === 'itemEquipped') {
    const item = sheet?.inventory[edit.index];
    const changed = item && {
      name: item.name,
      quantity: edit.field === 'itemQuantity' ? edit.value : item.quantity,
      equipped: edit.field === 'itemEquipped' ? edit.value : item.equipped,
    };
    next = overlay && changed && { ...overlay, inventory: { ...overlay.inventory, [String(edit.index)]: changed } };
  } else if (edit.field === 'hitDiceUsed') {
    next = overlay && { ...overlay, hitDiceUsed: edit.value };
  } else if (edit.field === 'currency') {
    next = overlay && { ...overlay, currency: { ...overlay.currency, [edit.coin]: edit.value } };
  }
  return next ?? null;
}

/** The context of `view` from the open encounter, the campaign's switches, the library and the player's files. */
export function sheetEditContext(view: string): SheetEditContext | null {
  const { encounter } = useEncounterStore.getState();
  const { features } = useViewLinksStore.getState();
  const own = encounter ? ownCharacter(encounter, view) : undefined;
  const creature = own ? findCreature(own.creature) : null;
  const stored = creature ? useLibraryStore.getState().characterSheets[creature.id] : undefined;
  // The same sheet the publisher sends, so item indexes match.
  const sheet = creature && features.sheets ? (stored ?? sheetFromCreature(creature)) : null;
  const overlay = usePlayerDataStore.getState().overlays[view] ?? null;
  return encounter && { encounter, features, creature, sheet, overlay };
}

/** Encounter values as one undo step named after the change, file values into the player's overlay. */
function applySheetEdit(
  ctx: SheetEditContext,
  view: string,
  check: Exclude<SheetEditCheck, { refused: string }>,
  edit: SheetEdit,
) {
  const { update } = useEncounterStore.getState();
  const campaignId = useViewLinksStore.getState().campaignId;
  const overlay = overlayAfter(ctx, edit);
  const log = `${check.text} (player)`;
  if (overlay && campaignId) {
    storePlayerSheet(campaignId, view, overlay).catch(useAppStore.getState().reportError);
    update((d) => addLog(d, 'note', log));
  } else {
    const owed: Record<string, number> = {};
    update((d) => {
      const c = d.combatants.find((each) => each.id === check.combatant.id)!;
      addLog(d, 'note', log);
      if (edit.field === 'hp') {
        const before = c.hp.current;
        c.hp.current = edit.value;
        const dc = settleHpChange(d, c, before, Math.max(0, before - edit.value));
        if (dc !== null) owed[c.id] = dc;
      } else if (edit.field === 'tempHp') {
        c.hp.temp = edit.value;
      } else if (edit.field === 'slotsUsed') {
        c.resources.slotsUsed[String(edit.level)] = edit.value;
      } else if (edit.field === 'deathSaves') {
        c.deathSaves = { successes: edit.successes, failures: edit.failures };
      }
    }, check.text);
    queueConcentrationChecks(owed);
  }
}

/**
 * A player's sheet edit: refused with a notice, applied at once, or queued for the DM in 'approve' mode (a
 * newer edit of the same value replaces the queued one; the queue is kept in the player's folder). Asking in
 * 'approve' mode for the value the character already has takes back the queued edit of that value.
 */
export function handleSheetEdit(view: string, request: SheetEditRequest, reply: (payload: SyncPayload) => void): void {
  const ctx = sheetEditContext(view);
  const check: SheetEditCheck = ctx ? checkSheetEdit(ctx, view, request) : { refused: 'no encounter is open' };
  const approve = ctx?.features.sheetEdits === 'approve';
  const target = sheetEditTarget(request.edit);
  const withdrawn =
    approve && 'refused' in check && check.refused === UNCHANGED
      ? usePlayerDataStore.getState().pending.find((p) => p.view === view && sheetEditTarget(p.edit) === target)
      : undefined;
  if (withdrawn) {
    takeSheetEdit(withdrawn.id);
    reply({ type: 'notice', text: `Taken back: ${withdrawn.text}`, settles: request.edit });
  } else if ('refused' in check) {
    useAppStore.getState().notify(`A player's sheet edit was refused: ${check.refused}`, 'info');
    reply({ type: 'notice', text: `Not changed: ${check.refused}`, settles: request.edit });
  } else if (ctx && approve) {
    // Switches other than 'off' come only from a linked campaign.
    const campaignId = useViewLinksStore.getState().campaignId!;
    queueSheetEdit(campaignId, view, { id: newId(), edit: request.edit, text: check.text, before: check.before });
    reply({ type: 'notice', text: `Waiting for the DM: ${check.text}` });
  } else if (ctx) {
    applySheetEdit(ctx, view, check, request.edit);
  }
}

/** Applies a queued edit unless it no longer passes or the DM changed the value since the player asked. */
export function acceptSheetEdit(id: string): void {
  const pending = takeSheetEdit(id);
  if (pending) {
    const { view, edit } = pending;
    const ctx = sheetEditContext(view);
    const request: SheetEditRequest = { type: 'sheetEdit', combatantId: view, edit };
    const check: SheetEditCheck = ctx ? checkSheetEdit(ctx, view, request) : { refused: 'no encounter is open' };
    if ('refused' in check) {
      useAppStore.getState().notify(`A player's sheet edit was refused: ${check.refused}`, 'info');
      sendPlayerNotice(view, `Not changed: ${check.refused}`, edit);
    } else if (check.before !== pending.before) {
      sendPlayerNotice(view, `Not changed, the DM changed it meanwhile: ${pending.text}`, edit);
    } else if (ctx) {
      applySheetEdit(ctx, view, check, edit);
      sendPlayerNotice(view, `The DM accepted: ${check.text}`, edit);
    }
  }
}

export function rejectSheetEdit(id: string): void {
  const pending = takeSheetEdit(id);
  if (pending) {
    sendPlayerNotice(pending.view, `The DM declined: ${pending.text}`, pending.edit);
  }
}
