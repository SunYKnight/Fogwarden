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

/** The usual action as a button; the arrow beside it lists the rarer alternatives. */
export function SplitButton({ icon, label, variant = 'default', onClick, menuLabel, items }: SplitButtonProps) {
  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    openContextMenu(box.left, box.bottom + 4, items);
  };
  return (
    <div className="split-button" role="group" aria-label={label}>
      <Button icon={icon} label={label} variant={variant} onClick={onClick} />
      <Button icon="chevronDown" label={menuLabel} iconOnly variant={variant} aria-haspopup="menu" onClick={openMenu} />
    </div>
  );
}
