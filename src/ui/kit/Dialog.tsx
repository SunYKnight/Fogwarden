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

/** Open dialogs, innermost last: Esc closes only the dialog on top. */
const openDialogs: object[] = [];

/** Modal dialog: Esc and the backdrop close it, focus moves into it on open. */
export function Dialog({ title, onClose, children, footer, width = 520 }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const token = useRef({});
  useEffect(() => {
    const own = token.current;
    openDialogs.push(own);
    return () => void openDialogs.splice(openDialogs.indexOf(own), 1);
  }, []);
  useEffect(() => {
    // Fields first: the header's Close button comes first in document order.
    const root = box.current;
    const first =
      root?.querySelector<HTMLElement>('.dialog-body input, .dialog-body select, .dialog-body textarea') ??
      root?.querySelector<HTMLElement>('button.btn-primary, .dialog-foot button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openDialogs.at(-1) === token.current) {
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
  /** Second way to go ahead, e.g. "Import as copy" next to "Replace"; the primary button. */
  alternativeLabel?: string;
}

export type Choice = 'confirm' | 'alternative' | 'cancel';

interface ConfirmState {
  request: { options: ConfirmOptions; resolve: (choice: Choice) => void } | null;
}

const useConfirmStore = create<ConfirmState>(() => ({ request: null }));

/** Asks with Cancel, the confirming button and, when labelled, an alternative; resolves the one picked. */
export function choiceDialog(options: ConfirmOptions): Promise<Choice> {
  const { promise, resolve } = Promise.withResolvers<Choice>();
  useConfirmStore.getState().request?.resolve('cancel');
  useConfirmStore.setState({ request: { options, resolve } });
  return promise;
}

/** In-app replacement for window.confirm; resolves true when the user confirms. */
export async function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return (await choiceDialog(options)) === 'confirm';
}

export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const finish = (choice: Choice) => {
    request?.resolve(choice);
    useConfirmStore.setState({ request: null });
  };
  const alternative = request?.options.alternativeLabel;
  return request ? (
    <Dialog
      title={request.options.title}
      onClose={() => finish('cancel')}
      width={440}
      footer={
        <>
          <Button label="Cancel" onClick={() => finish('cancel')} />
          <Button
            label={request.options.confirmLabel}
            variant={request.options.danger ? 'danger' : alternative ? 'default' : 'primary'}
            onClick={() => finish('confirm')}
          />
          {alternative && <Button label={alternative} variant="primary" onClick={() => finish('alternative')} />}
        </>
      }
    >
      <p>{request.options.message}</p>
    </Dialog>
  ) : null;
}
