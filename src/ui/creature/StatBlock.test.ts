import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createCreature } from '@/core/model';
import { StatBlock } from './StatBlock';

describe('StatBlock', () => {
  it('shows "?" for a damage formula that is no dice instead of throwing', () => {
    const creature = {
      ...createCreature('Goblin'),
      actions: [
        {
          name: 'Bite',
          description: '',
          attack: {
            kind: 'melee-weapon' as const,
            toHit: 4,
            reachFt: 5,
            rangeFt: null,
            targets: 'one target',
            damage: [{ formula: '1d', type: 'piercing' as const }],
          },
        },
      ],
    };
    const html = renderToStaticMarkup(createElement(StatBlock, { creature }));
    expect(html).toContain('Hit: ? (1d) piercing damage.');
  });
});
