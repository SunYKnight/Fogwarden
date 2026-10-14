import type { MouseEvent } from 'react';
import { Button, openContextMenu, type ButtonVariant, type IconName, type MenuItem } from '../kit';

interface SplitButtonProps {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  onClick: () => void;
  /** Accessible name of the arrow part. */
  menuLabel: string;
  items: MenuItem[];
}

/** Click handler that opens `items` as a menu below the clicked button. */
function menuBelow(items: MenuItem[]): (e: MouseEvent<HTMLButtonElement>) => void {
  return (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    openContextMenu(box.left, box.bottom + 4, items);
  };
}

/** The usual action as a button; the arrow beside it lists the rarer alternatives. */
export function SplitButton({ icon, label, variant = 'default', onClick, menuLabel, items }: SplitButtonProps) {
  return (
    <div className="split-button" role="group" aria-label={label}>
      <Button icon={icon} label={label} variant={variant} onClick={onClick} />
      <Button
        icon="chevronDown"
        label={menuLabel}
        iconOnly
        variant={variant}
        aria-haspopup="menu"
        onClick={menuBelow(items)}
      />
    </div>
  );
}

/** A button that only opens a menu, for a group of actions with no usual one. */
export function MenuButton({ icon, label, items }: { icon: IconName; label: string; items: MenuItem[] }) {
  return <Button icon={icon} label={`${label} ▾`} aria-haspopup="menu" onClick={menuBelow(items)} />;
}
