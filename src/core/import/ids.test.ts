import { describe, expect, it } from 'vitest';
import { freeDocumentId } from './ids';

describe('freeDocumentId', () => {
  const none = new Set<string>();

  it('derives a lower-case ASCII id from the name', () => {
    expect(freeDocumentId('Goblin Boss', 'creature', none)).toBe('goblin-boss');
    expect(freeDocumentId('  Él Niño: the Wave! ', 'map', none)).toBe('el-nino-the-wave');
  });

  it('names duplicates after their "copy" name', () => {
    expect(freeDocumentId('Goblin copy', 'creature', new Set(['goblin']))).toBe('goblin-copy');
  });

  it('counts up while the id is taken in the folder', () => {
    expect(freeDocumentId('Goblin', 'creature', new Set(['goblin']))).toBe('goblin-2');
    expect(freeDocumentId('Goblin', 'creature', new Set(['goblin', 'goblin-2']))).toBe('goblin-3');
  });

  it('uses the fallback for names without letters or digits', () => {
    expect(freeDocumentId('', 'creature', none)).toBe('creature');
    expect(freeDocumentId('???', 'map', new Set(['map']))).toBe('map-2');
  });

  it('never uses a Windows device name', () => {
    expect(freeDocumentId('Con', 'creature', none)).toBe('con-2');
    expect(freeDocumentId('NUL', 'creature', none)).toBe('nul-2');
    expect(freeDocumentId('Aux', 'creature', none)).toBe('aux-2');
    expect(freeDocumentId('COM1', 'map', none)).toBe('com1-2');
    expect(freeDocumentId('Console', 'map', none)).toBe('console');
  });

  it('caps the id at 60 characters, counter included', () => {
    const name = `${'a'.repeat(58)} bc`;
    const id = freeDocumentId(name, 'map', none);
    expect(id).toBe(`${'a'.repeat(58)}-b`);
    expect(freeDocumentId(name, 'map', new Set([id]))).toBe(`${'a'.repeat(58)}-2`);
    expect(freeDocumentId('x'.repeat(80), 'map', none)).toHaveLength(60);
  });
});
