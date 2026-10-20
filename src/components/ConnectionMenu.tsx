import React from 'react';
import type { ConnectionPathEntry } from '../utils/connectionPaths';
import ConnectionPair, { connectionLabel } from './ConnectionPair';

interface ConnectionMenuProps {
    entries: ConnectionPathEntry[];
    portraits?: ReadonlyMap<string, string>;
    onShow: (entry: ConnectionPathEntry) => void;
    onDismiss: () => void;
    style: React.CSSProperties;
}

// The menu a guest's connection chip opens: the saved connections that brought them in, each played by a click. It looks
// and behaves like the figure ActionBar (the canvas keeps either one open, and dismisses both the same way).
const ConnectionMenu: React.FC<ConnectionMenuProps> = ({ entries, portraits, onShow, onDismiss, style }) => {
    const stop = (event: React.PointerEvent | React.MouseEvent) => event.stopPropagation();
    return (
        <div data-figure-actions className="absolute z-[60] flex flex-col animate-in fade-in zoom-in-95 duration-200 origin-top-left cursor-default"
            style={style} onPointerDown={stop} onPointerUp={stop} onClick={stop} onMouseDown={stop} onMouseUp={stop}>
            <ul className="bg-surface/60 backdrop-blur-xl border border-accent-border/50 shadow-2xl rounded-lg overflow-hidden min-w-[140px] flex flex-col" aria-label="Connections">
                {entries.map(entry => (
                    <li key={entry.key} className="border-b border-border-subtle/30 last:border-b-0">
                        <button type="button" onClick={() => { onDismiss(); onShow(entry); }}
                            className="w-full flex items-center gap-3 px-3 py-1.5 text-base font-normal text-left text-accent-heading hover:bg-accent-soft/40 hover:text-accent-emphasis transition-all">
                            <ConnectionPair entries={[entry]} portraits={portraits} size={24} />
                            <span className="flex-1 whitespace-nowrap">{connectionLabel(entry)}</span>
                            <span className="text-xs font-bold whitespace-nowrap" style={{ color: 'rgb(var(--color-connection))' }}>
                                {entry.figures.length - 1} {entry.figures.length === 2 ? 'degree' : 'degrees'}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default ConnectionMenu;
