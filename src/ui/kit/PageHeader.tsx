import { Fragment, type ReactNode } from 'react';
import { useAppStore, type Route } from '@/state/appStore';
import { Icon } from './icons';

export interface Crumb {
  label: string;
  route?: Route;
}

interface PageHeaderProps {
  crumbs: Crumb[];
  /** Short state text next to the title, e.g. "Saved" or "Round 2". */
  status?: ReactNode;
  /** Page actions, right aligned. */
  children?: ReactNode;
}

/** Header of every page: breadcrumb trail, status and page actions. */
export function PageHeader({ crumbs, status, children }: PageHeaderProps) {
  const navigate = useAppStore((s) => s.navigate);
  return (
    <header className="page-header">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {crumbs.map((crumb, i) => (
          <Fragment key={`${crumb.label}-${i}`}>
            {i > 0 && <Icon name="chevronRight" size={14} className="crumb-sep" />}
            {crumb.route && i < crumbs.length - 1 ? (
              <button type="button" className="crumb" onClick={() => crumb.route && navigate(crumb.route)}>
                {crumb.label}
              </button>
            ) : (
              <span className={i === crumbs.length - 1 ? 'crumb current' : 'crumb'}>{crumb.label}</span>
            )}
          </Fragment>
        ))}
      </nav>
      {status && <span className="page-status">{status}</span>}
      <div className="spacer" />
      {children}
    </header>
  );
}
