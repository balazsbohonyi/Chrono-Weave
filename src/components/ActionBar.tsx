import React from 'react';
import { HistoricalFigure } from '../types';
import { useFigureActions } from '../hooks/useFigureActions';

interface ActionBarProps {
    figure: HistoricalFigure;
    onDiscover: (figure: HistoricalFigure) => void;
    onTrace: (figure: HistoricalFigure, clientY: number) => void;
    onInspect: (figure: HistoricalFigure) => void;
    isDiscovering: boolean;
    style: React.CSSProperties;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

const ActionBar: React.FC<ActionBarProps> = ({
    figure,
    onDiscover,
    onTrace,
    onInspect,
    isDiscovering,
    style,
    onMouseEnter,
    onMouseLeave
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
            className="absolute z-[60] flex flex-col animate-in fade-in zoom-in-95 duration-200 origin-top-left cursor-default"
            style={style}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onPointerDown={preventCanvasInteraction}
            onPointerUp={preventCanvasInteraction}
            onClick={preventCanvasInteraction}
            onMouseDown={preventCanvasInteraction}
            onMouseUp={preventCanvasInteraction}
        >
            <div className="bg-white/60 backdrop-blur-xl border border-blue-200/50 shadow-2xl rounded-lg overflow-hidden min-w-[140px] flex flex-col">
                {actions.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={item.onClick}
                        disabled={item.isLoading}
                        className={`
                        w-full flex items-center gap-3 px-3 py-1.5 text-base font-normal transition-all text-left group
                        disabled:opacity-50 disabled:cursor-not-allowed
                        text-blue-800 hover:bg-blue-100/40 hover:text-blue-900 border-b border-gray-100/30 last:border-b-0
                    `}
                    >
                        <div className="flex-shrink-0 text-blue-600 group-hover:text-blue-700 transition-colors">
                            {item.isLoading ? (
                                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
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
