import { useEffect, useRef } from 'react';

/** Open dialogs, popovers and menus, innermost last: Esc closes only the one on top. */
const openLayers: object[] = [];

/** Whether a dialog, popover or menu is open; page shortcuts must not act behind it. */
export function isLayerOpen(): boolean {
  return openLayers.length > 0;
}

/**
 * Registers a dialog, popover or menu while `active`. Esc reaches only the innermost layer: it calls that layer's
 * `onEscape` and goes no further, so neither an outer dialog nor a page shortcut sees it.
 */
export function useLayer(active: boolean, onEscape: () => void): void {
  const token = useRef({}).current;
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openLayers.at(-1) === token) {
        event.stopImmediatePropagation();
        latest.current();
      }
    };
    if (active) {
      openLayers.push(token);
      window.addEventListener('keydown', onKey, true);
    }
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const index = openLayers.indexOf(token);
      if (index >= 0) openLayers.splice(index, 1);
    };
  }, [active, token]);
}
