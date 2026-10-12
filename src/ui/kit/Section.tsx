import { useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `panel ${className}` : 'panel'}>{children}</div>;
}

interface SectionProps {
  title: string;
  children: ReactNode;
  /** Buttons shown at the right of the heading. */
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export function Section({ title, children, actions, collapsible = false, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shown = !collapsible || open;
  return (
    <section className="section">
      <div className="section-head">
        {collapsible ? (
          <button
            type="button"
            className="section-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
            <h3>{title}</h3>
          </button>
        ) : (
          <h3>{title}</h3>
        )}
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      {shown && (
        <div id={bodyId} className="section-body">
          {children}
        </div>
      )}
    </section>
  );
}

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
  /** Small count or marker after the label. */
  badge?: string;
}

interface TabsProps<T extends string> {
  tabs: TabSpec<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: TabsProps<T>) {
  return (
    <div className="kit-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          className={t.id === value ? 'kit-tab active' : 'kit-tab'}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <Icon name={t.icon} size={16} />}
          <span>{t.label}</span>
          {t.badge && <span className="badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon: IconName;
  title: string;
  children?: ReactNode;
  /** The next action, usually one primary button. */
  action?: ReactNode;
}

export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={32} />
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/** Thin bar at the bottom of map screens: hint left, readouts right. */
export function StatusBar({ hint, children }: { hint?: string; children?: ReactNode }) {
  return (
    <div className="status-bar" role="status">
      <span className="status-hint">{hint}</span>
      <span className="status-readouts">{children}</span>
    </div>
  );
}
