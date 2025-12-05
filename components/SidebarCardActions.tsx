import React from 'react';
import { HistoricalFigure } from '../types';
import Tooltip from './Tooltip';
import { useFigureActions } from '../hooks/useFigureActions';

interface SidebarCardActionsProps {
    figure: HistoricalFigure;
    onDiscover: (figure: HistoricalFigure) => void;
    onInspect: (figure: HistoricalFigure) => void;
    onTrace: (figure: HistoricalFigure, clientY: number) => Promise<void>;
    isTracing: boolean;
}

const SidebarCardActions: React.FC<SidebarCardActionsProps> = ({ figure, onDiscover, onInspect, onTrace, isTracing }) => {
    const actions = useFigureActions({
        figure,
        onDiscover,
        onTrace: (f, y) => onTrace(f, y),
        onInspect,
        isDiscovering: false,
        isTracing
    });

    return (
        <div className="absolute bottom-0 left-0 right-0 p-2 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
            {actions.map(action => (
                <Tooltip key={action.id} text={action.label}>
                    <button
                        onClick={action.onClick}
                        disabled={action.isLoading}
                        className={`p-2 rounded-md border transition-colors ${action.isLoading
                                ? 'bg-blue-50 text-blue-400 border-blue-100 cursor-wait'
                                : 'bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-100'
                            }`}
                    >
                        {action.isLoading ? (
                            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            action.icon
                        )}
                    </button>
                </Tooltip>
            ))}
        </div>
    );
};

export default SidebarCardActions;
