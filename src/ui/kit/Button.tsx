import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon?: IconName;
  /** Visible text; with `iconOnly` it becomes the tooltip and accessible name. */
  label: string;
  iconOnly?: boolean;
  variant?: ButtonVariant;
  active?: boolean;
  /** Key shown in the tooltip, e.g. "Ctrl+Z". */
  shortcut?: string;
  children?: ReactNode;
}

export function Button(props: ButtonProps) {
  const { icon, label, iconOnly = false, variant = 'default', active = false, shortcut, className, ...rest } = props;
  const classes = ['btn', `btn-${variant}`, active ? 'active' : '', iconOnly ? 'btn-icon' : '', className ?? '']
    .filter((c) => c.length > 0)
    .join(' ');
  const tip = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className={classes}
      title={iconOnly || shortcut ? tip : rest.title}
      aria-label={iconOnly ? label : undefined}
      aria-pressed={active || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {!iconOnly && <span>{label}</span>}
      {props.children}
    </button>
  );
}

interface ToolButtonProps {
  icon: IconName;
  label: string;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}

/** Tool palette entry: icon above its name, shortcut badge in the corner. */
export function ToolButton({ icon, label, shortcut, active, onClick, disabled }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={active ? 'tool-button active' : 'tool-button'}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut.toUpperCase()})` : label}
    >
      <Icon name={icon} size={20} />
      <span className="tool-label">{label}</span>
      {shortcut && <kbd className="tool-key">{shortcut.toUpperCase()}</kbd>}
    </button>
  );
}

export function Toolbar({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="toolbar-row" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}
