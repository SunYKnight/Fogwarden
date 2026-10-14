import { useAppStore, type NoticeKind } from '@/state/appStore';
import { Button } from './Button';
import { Icon, type IconName } from './icons';

const NOTICE_ICON: Record<NoticeKind, IconName> = { error: 'alert', success: 'check', info: 'info' };

/** Errors and confirmations in the bottom right corner. */
export function ToastHost() {
  const notices = useAppStore((s) => s.notices);
  const dismiss = useAppStore((s) => s.dismissNotice);
  return (
    <div className="toasts" role="log" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`toast toast-${n.kind}`} role={n.kind === 'error' ? 'alert' : undefined}>
          <Icon name={NOTICE_ICON[n.kind]} />
          <span style={{ flex: 1 }}>{n.message}</span>
          <Button icon="close" label="Dismiss" iconOnly variant="ghost" onClick={() => dismiss(n.id)} />
        </div>
      ))}
    </div>
  );
}
