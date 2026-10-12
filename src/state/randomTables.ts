import { useMemo } from 'react';
import { findTable, rollOnTable, type TableRoll } from '@/core/tables';
import { useLibraryStore } from './libraryStore';

/** Rolls on a library table by id or name; `[name]` references inside resolve against the library too. */
export function rollTable(tableRef: string): TableRoll {
  const tables = useLibraryStore.getState().listings.table.entries.map((e) => e.doc);
  const table = findTable(tables, tableRef);
  if (table === undefined) {
    throw new Error(`No random table "${tableRef}" in the Compendium`);
  }
  return rollOnTable(table, { find: (ref) => findTable(tables, ref) });
}

/** Tables of the Compendium for pickers, sorted by name. */
export function useRandomTables(): { id: string; name: string }[] {
  const entries = useLibraryStore((s) => s.listings.table.entries);
  return useMemo(() => entries.map((e) => ({ id: e.ref.id, name: e.doc.name })), [entries]);
}
