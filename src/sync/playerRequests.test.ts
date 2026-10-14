import { describe, expect, it } from 'vitest';
import { createCreature, createEncounter, createMap, PARTY_VIEW, type Combatant, type Encounter } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { FOG_EXPLORED, FOG_UNKNOWN, FOG_VISIBLE, fogSize, type FogCells } from '@/core/vision/fog';
import { addParty, createPc } from '@/state/encounterActions';
import { checkPlayerMove, pingAudience } from './playerRequests';
import { playerViews } from './views';

const map = createMap({ name: 'm', image: null, squaresX: 6, squaresY: 6, pxPerSquare: 50 });
const terrain = HeightField.fromMap(map);
const at = (x: number, y: number, elevationFt = 0) => ({ x, y, elevationFt });
const pc = (name: string): Combatant => ({
  ...createPc({ name, armorClass: 12, maxHp: 10, senses: {}, visionSource: true }),
  position: at(2.5, 2.5),
});
const thorin = pc('Thorin');
const elara = pc('Elara');

function rules(change: Partial<Encounter> = {}) {
  const encounter = { ...createEncounter('e', 'c1', null), combatants: [thorin, elara], playersMoveTokens: true };
  return { encounter: { ...encounter, ...change }, map, terrain, diagonalRule: '5-5-5' as const };
}

const move = (combatantId: string, to = at(13, 2)) => ({ type: 'move' as const, combatantId, to });

describe('checkPlayerMove', () => {
  it('snaps the move to whole squares and measures it by the grid rule', () => {
    expect(checkPlayerMove(rules(), thorin.id, move(thorin.id))).toEqual({
      combatant: thorin,
      to: at(12.5, 2.5),
      feet: 10,
    });
  });

  it('keeps the height of a flying token above the ground', () => {
    const flying = { ...thorin, position: at(2.5, 2.5, 20) };
    const check = checkPlayerMove(rules({ combatants: [flying] }), thorin.id, move(thorin.id));
    expect(check).toMatchObject({ to: at(12.5, 2.5, 20) });
  });

  it('refuses moves while the encounter does not allow them', () => {
    const check = checkPlayerMove(rules({ playersMoveTokens: false }), thorin.id, move(thorin.id));
    expect(check).toEqual({ refused: 'players may not move their tokens in this encounter' });
  });

  it("refuses another view's token and the party view", () => {
    expect(checkPlayerMove(rules(), thorin.id, move(elara.id))).toEqual({
      refused: 'that token belongs to another view',
    });
    expect(checkPlayerMove(rules(), PARTY_VIEW, move(thorin.id))).toEqual({
      refused: 'that token belongs to another view',
    });
  });

  it('refuses tokens that are not a visible, placed player character', () => {
    const goblin = { ...thorin, side: 'enemy' as const };
    const hidden = { ...thorin, hiddenFromPlayers: true };
    const unplaced = { ...thorin, position: null };
    const refusal = (c: Combatant) => checkPlayerMove(rules({ combatants: [c] }), c.id, move(c.id));
    expect(refusal(goblin)).toEqual({ refused: 'that token is not a player character' });
    expect(refusal(hidden)).toEqual({ refused: 'the token is hidden from the players' });
    expect(refusal(unplaced)).toEqual({ refused: 'the token is not on the map' });
  });

  it('refuses moves in an encounter without a map', () => {
    const check = checkPlayerMove({ ...rules(), map: null, terrain: null }, thorin.id, move(thorin.id));
    expect(check).toEqual({ refused: 'the encounter has no map' });
  });

  it("lets a party member's view move that member's token", () => {
    const creature = { ...createCreature('Brom'), kind: 'player' as const };
    const member = { id: 'm-brom', creature: { area: 'data', id: creature.id }, player: 'Ben' } as const;
    const { encounter } = rules();
    addParty(encounter, [{ member, creature }]);
    const brom = { ...encounter.combatants[2]!, position: at(2.5, 2.5) };
    const view = playerViews(encounter)[3]!.id;
    const check = checkPlayerMove(rules({ combatants: [brom] }), view, move(brom.id));
    expect(check).toMatchObject({ combatant: { name: 'Brom', partyMemberId: member.id }, feet: 10 });
  });
});

describe('pingAudience', () => {
  // One cell per square, six in a row on the top line: unknown, explored, visible.
  const size = fogSize(map.grid, 1);
  const fog = (...row: number[]): FogCells => ({
    size,
    cells: Uint8Array.from({ length: 36 }, (_, i) => (i < row.length ? row[i]! : FOG_UNKNOWN)),
  });
  const fogs: Record<string, FogCells | null> = {
    [PARTY_VIEW]: fog(FOG_VISIBLE, FOG_VISIBLE, FOG_EXPLORED),
    [thorin.id]: fog(FOG_VISIBLE, FOG_EXPLORED),
    [elara.id]: fog(FOG_UNKNOWN, FOG_UNKNOWN, FOG_VISIBLE),
  };
  const views = [PARTY_VIEW, thorin.id, elara.id];
  const audience = (x: number, from: string | null) => pingAudience(at(x, 2.5), from, views, (v) => fogs[v]!);

  it('reaches the views that see the spot or have explored it', () => {
    expect(audience(2.5, null)).toEqual([PARTY_VIEW, thorin.id]);
    expect(audience(7.5, null)).toEqual([PARTY_VIEW, thorin.id]);
    expect(audience(12.5, null)).toEqual([PARTY_VIEW, elara.id]);
  });

  it('always reaches the view that pointed, even into its unknown fog', () => {
    expect(audience(22.5, elara.id)).toEqual([elara.id]);
  });

  it('reaches every view without fog', () => {
    expect(pingAudience(at(22.5, 2.5), null, views, () => null)).toEqual(views);
  });
});
