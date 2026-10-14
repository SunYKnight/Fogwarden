import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { Dialog } from './Dialog';
import { isLayerOpen } from './layers';

export interface Shortcut {
  /** Key combination such as "Ctrl+Z", "Shift+Delete", "Space", "Escape", "?" or "v". */
  keys: string;
  label: string;
  run: (event: KeyboardEvent) => void;
  /** Also fire while a text field has focus (e.g. Ctrl+K). */
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
function matchesKeys(keys: string, event: KeyboardEvent): boolean {
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

// Checkboxes, sliders and buttons take no text, so shortcuts still apply.
const TEXT_INPUT = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="color"])';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || target.matches(`${TEXT_INPUT}, textarea, select`))
  );
}

/** Space on a focused button or option presses that control, not a page shortcut. */
const SPACE_CONTROL = 'button, a[href], [role="button"], [role="tab"], [role="option"], [role="menuitem"]';

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
  const pressesControl =
    event.key === ' ' && event.target instanceof Element && event.target.closest(SPACE_CONTROL) !== null;
  // Held keys repeat: one turn per press, not a run of skipped turns.
  const ignored = event.repeat || pressesControl || isLayerOpen();
  const registrations = [...useShortcutStore.getState().registrations].reverse();
  return ignored
    ? undefined
    : registrations.flatMap((r) => r.shortcuts).find((s) => (!typing || s.inInputs) && matchesKeys(s.keys, event));
}

/** Global key dispatcher and the "?" overlay; mounted once by the app shell. */
export function ShortcutHost() {
  const overlayOpen = useShortcutStore((s) => s.overlayOpen);
  const registrations = useShortcutStore((s) => s.registrations);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = findShortcut(event);
      // The list is a dialog itself: "?" closes it, opens it only over a page.
      const help =
        !isTyping(event.target) &&
        matchesKeys('?', event) &&
        (useShortcutStore.getState().overlayOpen || !isLayerOpen());
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
