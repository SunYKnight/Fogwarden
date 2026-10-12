import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Button } from './Button';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** Modal dialog: Esc and the backdrop close it, focus moves into it on open. */
export function Dialog({ title, onClose, children, footer, width = 520 }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>('input, select, textarea, button.btn-primary, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <Button icon="close" label="Close" iconOnly variant="ghost" onClick={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmOptions {
  title: string;
  /** What exactly happens, e.g. which data is deleted. */
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

interface ConfirmState {
  request: { options: ConfirmOptions; resolve: (ok: boolean) => void } | null;
}

const useConfirmStore = create<ConfirmState>(() => ({ request: null }));

/** In-app replacement for window.confirm; resolves true when the user confirms. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  useConfirmStore.getState().request?.resolve(false);
  useConfirmStore.setState({ request: { options, resolve } });
  return promise;
}

export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const finish = (ok: boolean) => {
    request?.resolve(ok);
    useConfirmStore.setState({ request: null });
  };
  return request ? (
    <Dialog
      title={request.options.title}
      onClose={() => finish(false)}
      width={440}
      footer={
        <>
          <Button label="Cancel" onClick={() => finish(false)} />
          <Button
            label={request.options.confirmLabel}
            variant={request.options.danger ? 'danger' : 'primary'}
            onClick={() => finish(true)}
          />
        </>
      }
    >
      <p>{request.options.message}</p>
    </Dialog>
  ) : null;
}
