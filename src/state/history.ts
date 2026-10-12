import type { Patch } from 'immer';

export type HistoryEntry =
  | { kind: 'patches'; label: string; patches: Patch[]; inverse: Patch[] }
  | { kind: 'terrain'; label: string; before: Float32Array; after: Float32Array };

const MAX_ENTRIES = 40;

/** Bounded undo/redo stacks; pushing a new entry discards the redo branch. */
export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  push(entry: HistoryEntry): void {
    this.past.push(entry);
    if (this.past.length > MAX_ENTRIES) {
      this.past.shift();
    }
    this.future = [];
  }

  takeUndo(): HistoryEntry | undefined {
    const entry = this.past.pop();
    if (entry) {
      this.future.push(entry);
    }
    return entry;
  }

  takeRedo(): HistoryEntry | undefined {
    const entry = this.future.pop();
    if (entry) {
      this.past.push(entry);
    }
    return entry;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
