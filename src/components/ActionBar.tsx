import React from 'react';
import { HistoricalFigure } from '../types';
import { useFigureActions } from '../hooks/useFigureActions';

interface ActionBarProps {
    figure: HistoricalFigure;
    onDiscover: (figure: HistoricalFigure) => void;
    onTrace: (figure: HistoricalFigure) => void;
    onInspect: (figure: HistoricalFigure) => void;
    isDiscovering: boolean;
    style: React.CSSProperties;
}

const ActionBar: React.FC<ActionBarProps> = ({
    figure,
    onDiscover,
    onTrace,
    onInspect,
    isDiscovering,
    style
}) => {

    // Prevent events from reaching the canvas
    const preventCanvasInteraction = (e: React.PointerEvent | React.MouseEvent) => {
        e.stopPropagation();
    };

    const actions = useFigureActions({
        figure,
        onDiscover,
        onTrace,
        onInspect,
        isDiscovering
    });

    return (
        <div
            data-figure-actions
            className="absolute z-[60] flex flex-col animate-in fade-in zoom-in-95 duration-200 origin-top-left cursor-default"
            style={style}
            onPointerDown={preventCanvasInteraction}
            onPointerUp={preventCanvasInteraction}
            onClick={preventCanvasInteraction}
            onMouseDown={preventCanvasInteraction}
            onMouseUp={preventCanvasInteraction}
        >
            <div className="bg-surface/60 backdrop-blur-xl border border-accent-border/50 shadow-2xl rounded-lg overflow-hidden min-w-[140px] flex flex-col">
                {actions.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={item.onClick}
                        disabled={item.isLoading}
                        className={`
                        w-full flex items-center gap-3 px-3 py-1.5 text-base font-normal transition-all text-left group
                        disabled:opacity-50 disabled:cursor-not-allowed
                        text-accent-heading hover:bg-accent-soft/40 hover:text-accent-emphasis border-b border-border-subtle/30 last:border-b-0
                    `}
                    >
                        <div className="flex-shrink-0 text-accent-text group-hover:text-accent-text-hover transition-colors">
                            {item.isLoading ? (
                                <div className="w-5 h-5 border-2 border-accent-text border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                item.icon
                            )}
                        </div>
                        <span className="flex-1 whitespace-nowrap">{item.isLoading ? "Analyzing..." : item.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default ActionBar;
