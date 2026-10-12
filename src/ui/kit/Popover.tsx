import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Icon, type IconName } from './icons';

type Placement = 'below' | 'right';

interface PopoverProps {
  /** Renders the trigger; call `toggle` from its click handler. */
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  label: string;
}

/** Floating panel anchored to its trigger; closes on outside click and Esc. */
export function Popover({ trigger, children, placement = 'below', label }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // The anchor is `display: contents`, so the trigger element carries the geometry.
  useLayoutEffect(() => {
    const rect = anchor.current?.firstElementChild?.getBoundingClientRect();
    const size = panel.current?.getBoundingClientRect();
    if (open && rect && size) {
      const left = placement === 'right' ? rect.right + 8 : rect.left;
      const top = placement === 'right' ? rect.top : rect.bottom + 6;
      setPos({
        left: Math.max(8, Math.min(left, window.innerWidth - size.width - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - size.height - 8)),
      });
    }
  }, [open, placement]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      window.addEventListener('mousedown', onDown);
      window.addEventListener('keydown', onKey);
    }
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <>
      <span ref={anchor} className="popover-anchor">
        {trigger(open, () => setOpen(!open))}
      </span>
      {open &&
        createPortal(
          <div ref={panel} className="popover" role="dialog" aria-label={label} style={pos}>
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

interface ContextMenuState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
}

const useContextMenuStore = create<ContextMenuState>(() => ({ menu: null }));

export function openContextMenu(x: number, y: number, items: MenuItem[]): void {
  useContextMenuStore.setState({ menu: items.length > 0 ? { x, y, items } : null });
}

export function ContextMenuHost() {
  const menu = useContextMenuStore((s) => s.menu);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // Menus opened near the window edge flip inside instead of overflowing.
  useLayoutEffect(() => {
    const size = box.current?.getBoundingClientRect();
    if (menu && size) {
      setPos({
        left: Math.max(4, Math.min(menu.x, window.innerWidth - size.width - 4)),
        top: Math.max(4, Math.min(menu.y, window.innerHeight - size.height - 4)),
      });
    }
  }, [menu]);

  useEffect(() => {
    const close = (e: Event) => {
      if (!(e instanceof MouseEvent && box.current?.contains(e.target as Node))) {
        useContextMenuStore.setState({ menu: null });
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useContextMenuStore.setState({ menu: null });
    };
    if (menu) {
      window.addEventListener('mousedown', close);
      window.addEventListener('keydown', onKey);
      window.addEventListener('blur', close);
    }
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  return menu
    ? createPortal(
        <div ref={box} className="context-menu" role="menu" style={pos}>
          {menu.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'menu-item danger' : 'menu-item'}
              disabled={item.disabled}
              onClick={() => {
                useContextMenuStore.setState({ menu: null });
                item.run();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={16} /> : <span className="icon-spacer" />}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null;
}
