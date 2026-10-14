import type { Route } from '@/state/appStore';
import type { IconName } from '../kit';

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  route: Route;
  /** Whether the current route belongs to this destination (sub-pages included). */
  matches: (route: Route) => boolean;
}

/**
 * Main destinations in workflow order: content first (a new install imports its rules content), then campaigns,
 * maps for their encounters, and play.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', route: { page: 'home' }, matches: (r) => r.page === 'home' },
  {
    id: 'compendium',
    label: 'Compendium',
    icon: 'book',
    route: { page: 'compendium', tab: 'creatures' },
    matches: (r) => r.page === 'compendium' || r.page === 'creature-editor',
  },
  {
    id: 'campaigns',
    label: 'Campaigns',
    icon: 'swords',
    route: { page: 'campaigns', campaignId: null },
    matches: (r) => r.page === 'campaigns',
  },
  {
    id: 'maps',
    label: 'Maps',
    icon: 'map',
    route: { page: 'maps' },
    matches: (r) => r.page === 'maps' || r.page === 'map-editor',
  },
  { id: 'play', label: 'Play', icon: 'play', route: { page: 'play' }, matches: (r) => r.page === 'play' },
];
