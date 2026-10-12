import { useAppStore } from '@/state/appStore';
import { Icon } from '../kit';
import { NAV_ITEMS } from './nav';
import { PlayersMenu } from './PlayersMenu';

/** Always-visible navigation: workflow destinations on top, player view and settings at the bottom. */
export function NavRail() {
  const route = useAppStore((s) => s.route);
  const navigate = useAppStore((s) => s.navigate);
  const playing = useAppStore((s) => s.settings?.lastEncounter !== null && s.settings?.lastEncounter !== undefined);
  const settingsActive = route.page === 'settings';

  return (
    <nav className="rail" aria-label="Main">
      <div className="rail-brand" title="Fogwarden">
        FW
      </div>
      {NAV_ITEMS.map((item) => {
        const active = item.matches(route);
        return (
          <button
            key={item.id}
            type="button"
            className={active ? 'rail-item active' : 'rail-item'}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(item.route)}
          >
            <span className="rail-icon">
              <Icon name={item.icon} size={22} />
              {item.id === 'play' && playing && <span className="rail-dot" />}
            </span>
            <span className="rail-label">{item.label}</span>
          </button>
        );
      })}
      <div className="spacer" />
      <PlayersMenu />
      <button
        type="button"
        className={settingsActive ? 'rail-item active' : 'rail-item'}
        aria-current={settingsActive ? 'page' : undefined}
        onClick={() => navigate({ page: 'settings' })}
      >
        <span className="rail-icon">
          <Icon name="settings" size={22} />
        </span>
        <span className="rail-label">Settings</span>
      </button>
    </nav>
  );
}
