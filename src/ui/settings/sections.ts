import type { SettingsSection } from '@/state/appStore';
import type { TabSpec } from '../kit';

/** Settings sub-pages in display order: one-time setup first, reference last. */
export const SETTINGS_SECTIONS: TabSpec<SettingsSection>[] = [
  { id: 'data', label: 'Data', icon: 'folder' },
  { id: 'players', label: 'Players', icon: 'monitor' },
  { id: 'graphics', label: 'Graphics', icon: 'sun' },
  { id: 'audio', label: 'Audio', icon: 'volume' },
  { id: 'rules', label: 'Rules', icon: 'ruler' },
  { id: 'content', label: 'Content', icon: 'package' },
  { id: 'about', label: 'About', icon: 'info' },
];
