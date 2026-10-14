import type { KeyboardEvent } from 'react';

/** Key handler for focusable `role="option"` rows: Enter and Space act like a click. */
export function activateOnKey(activate: () => void): (event: KeyboardEvent) => void {
  return (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      // Space would otherwise scroll the list.
      event.preventDefault();
      activate();
    }
  };
}
