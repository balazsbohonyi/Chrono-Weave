import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LayoutMode } from '../../services/connectionNetworkLayout';
import Tooltip from '../Tooltip';
import { LAYOUT_OPTIONS, LayoutIcon, layoutOption } from './layoutOptions';

// `host` is a layer over the graph (inside the dialog) the menu is drawn in: out of the toolbar, so that its glass blurs the graph
// behind it like the toolbar's own does (a blur inside a blurred element sees only that element).
interface Props { mode: LayoutMode; onSelect: (mode: LayoutMode) => void; host: HTMLElement | null }
interface Place { left: number; bottom: number; room: number }

// One button for every way to arrange the graph. It shows the current layout; pressing it opens a menu above it with all of them,
// each an icon and a name, the current one highlighted. Esc closes the menu (and only the menu), arrows move through it.
const LayoutMenu: React.FC<Props> = ({ mode, onSelect, host }) => {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const root = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), items = useRef<Array<HTMLButtonElement | null>>([]);
  const current = layoutOption(mode);
  const close = useCallback((refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); }, []);

  useEffect(() => {
    if (!open) return;
    // A press anywhere else closes the menu; the graph underneath still gets it.
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    // The window sees a key before the overlay's own Esc handling does, so Esc peels off the menu first.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); close(true);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', resize); };
  }, [open, close]);

  // Opening puts the menu just above the button, inside the graph's panel (it scrolls when the panel is short), and the keyboard on the current layout.
  useLayoutEffect(() => {
    if (!open || !host || !trigger.current) return;
    const at = trigger.current.getBoundingClientRect(), box = host.getBoundingClientRect();
    setPlace({ left: at.left - box.left - 6, bottom: box.bottom - at.top + 16, room: Math.max(140, Math.floor(at.top - box.top - 30)) });
  }, [open, host]);
  useLayoutEffect(() => { if (open && place) items.current[LAYOUT_OPTIONS.findIndex(option => option.mode === mode)]?.focus(); }, [open, place === null]);

  const move = (event: React.KeyboardEvent) => {
    const count = LAYOUT_OPTIONS.length, at = items.current.findIndex(item => item === document.activeElement);
    const target = event.key === 'ArrowDown' ? (at + 1) % count : event.key === 'ArrowUp' ? (at - 1 + count) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
    if (target < 0) return;
    event.preventDefault(); items.current[target]?.focus();
  };

  const list = <div ref={menu} className="net-layout-menu" role="menu" aria-label="Graph layout" onKeyDown={move}
    style={place ? { left: place.left, bottom: place.bottom, maxHeight: place.room } : { visibility: 'hidden' }}>
    {LAYOUT_OPTIONS.map((option, index) => {
      const checked = option.mode === mode;
      return <button key={option.mode} ref={element => { items.current[index] = element; }} type="button" role="menuitemradio" aria-checked={checked}
        tabIndex={checked ? 0 : -1} className={`net-layout-item ${checked ? 'is-current' : ''}`}
        onClick={event => { close(event.detail === 0); if (!checked) onSelect(option.mode); }}>
        <LayoutIcon size={22}>{option.icon}</LayoutIcon>
        <span>{option.label}</span>
      </button>;
    })}
  </div>;

  return <div ref={root} className="net-layout-root">
    <Tooltip text={`Layout: ${current.label}`}>
      <button ref={trigger} type="button" className="canvas-floating-button net-layout-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={`Layout: ${current.label}`}
        onClick={event => { if (event.detail > 0 && open) event.currentTarget.blur(); setPlace(null); setOpen(value => !value); }}>
        <LayoutIcon>{current.icon}</LayoutIcon>
      </button>
    </Tooltip>
    {open && host && createPortal(list, host)}
  </div>;
};
export default LayoutMenu;
