import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { Dialog } from './Dialog';

export interface Shortcut {
  /** Key combination such as "Ctrl+Z", "Shift+Delete", "Space", "Escape", "?" or "v". */
  keys: string;
  label: string;
  run: (event: KeyboardEvent) => void;
  /** Also fire while a text field has focus (e.g. Escape). */
  inInputs?: boolean;
}

interface Registration {
  id: number;
  scope: string;
  shortcuts: Shortcut[];
}

interface ShortcutState {
  registrations: Registration[];
  overlayOpen: boolean;
}

const useShortcutStore = create<ShortcutState>(() => ({ registrations: [], overlayOpen: false }));
let nextId = 1;

const KEY_NAMES: Record<string, string> = { ' ': 'space', esc: 'escape', del: 'delete' };

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_NAMES[lower] ?? lower;
}

/** Whether `keys` describes this event; symbols like "?" ignore Shift because layouts differ. */
export function matchesKeys(keys: string, event: KeyboardEvent): boolean {
  const parts = keys.split('+').map((p) => p.trim().toLowerCase());
  const key = normalizeKey(parts[parts.length - 1]!);
  const wantCtrl = parts.includes('ctrl');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  const eventKey = normalizeKey(event.key);
  const symbol = eventKey.length === 1 && !/[a-z0-9]/.test(eventKey);
  return (
    eventKey === key &&
    (event.ctrlKey || event.metaKey) === wantCtrl &&
    event.altKey === wantAlt &&
    (symbol || event.shiftKey === wantShift)
  );
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/**
 * Registers keyboard shortcuts while the calling component is mounted. Later registrations win, so a dialog or
 * tool can override a page shortcut. The list is shown in the "?" overlay grouped by `scope`.
 */
export function useShortcuts(scope: string, shortcuts: Shortcut[], enabled = true): void {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  const signature = shortcuts.map((s) => `${s.keys}:${s.label}`).join('|');
  useEffect(() => {
    const id = nextId++;
    if (enabled) {
      const proxied = latest.current.map((s) => ({
        ...s,
        run: (e: KeyboardEvent) => latest.current.find((c) => c.keys === s.keys)?.run(e),
      }));
      useShortcutStore.setState((st) => ({ registrations: [...st.registrations, { id, scope, shortcuts: proxied }] }));
    }
    return () => useShortcutStore.setState((st) => ({ registrations: st.registrations.filter((r) => r.id !== id) }));
  }, [scope, signature, enabled]);
}

function findShortcut(event: KeyboardEvent): Shortcut | undefined {
  const typing = isTyping(event.target);
  const registrations = [...useShortcutStore.getState().registrations].reverse();
  return registrations.flatMap((r) => r.shortcuts).find((s) => (!typing || s.inInputs) && matchesKeys(s.keys, event));
}

/** Global key dispatcher and the "?" overlay; mounted once by the app shell. */
export function ShortcutHost() {
  const overlayOpen = useShortcutStore((s) => s.overlayOpen);
  const registrations = useShortcutStore((s) => s.registrations);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = findShortcut(event);
      const help = !isTyping(event.target) && matchesKeys('?', event);
      if (shortcut) {
        event.preventDefault();
        shortcut.run(event);
      } else if (help) {
        event.preventDefault();
        useShortcutStore.setState((s) => ({ overlayOpen: !s.overlayOpen }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scopes = [...new Set(registrations.map((r) => r.scope))];
  return overlayOpen ? (
    <Dialog title="Keyboard shortcuts" onClose={() => useShortcutStore.setState({ overlayOpen: false })}>
      <div className="shortcut-list">
        {scopes.map((scope) => (
          <div key={scope}>
            <h3>{scope}</h3>
            {registrations
              .filter((r) => r.scope === scope)
              .flatMap((r) => r.shortcuts)
              .map((s) => (
                <div key={`${scope}:${s.keys}`} className="shortcut-row">
                  <kbd>{s.keys}</kbd>
                  <span>{s.label}</span>
                </div>
              ))}
          </div>
        ))}
        <div className="shortcut-row">
          <kbd>?</kbd>
          <span>Show or hide this list</span>
        </div>
      </div>
    </Dialog>
  ) : null;
}
