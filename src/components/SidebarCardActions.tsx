import React from 'react';
import { HistoricalFigure } from '../types';
import Tooltip from './Tooltip';
import { useFigureActions } from '../hooks/useFigureActions';

interface SidebarCardActionsProps {
    figure: HistoricalFigure;
    onDiscover: (figure: HistoricalFigure) => void;
    onInspect: (figure: HistoricalFigure) => void;
    onTrace: (figure: HistoricalFigure) => Promise<void>;
    isTracing: boolean;
    isFollowingFigure?: boolean;
    focusFigureId?: string;
    onRelationship?: (figure: HistoricalFigure) => void;
}

const SidebarCardActions: React.FC<SidebarCardActionsProps> = ({ figure, onDiscover, onInspect, onTrace, isTracing,
    isFollowingFigure = false, focusFigureId, onRelationship }) => {
    const actions = useFigureActions({
        figure,
        onDiscover,
        onTrace,
        onInspect,
        isDiscovering: false,
        isTracing,
        isFollowingFigure,
        focusFigureId,
        onRelationship
    });

    return (
        <div className="absolute bottom-0 left-0 right-0 p-2 flex justify-end gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity duration-300 z-10">
            {actions.map(action => (
                <Tooltip key={action.id} text={action.label}>
                    <button
                        aria-label={action.label}
                        onClick={action.onClick}
                        disabled={action.isLoading}
                        className={`p-2 rounded-md border transition-colors ${action.isLoading
                                ? 'bg-action-surface text-accent-focus border-action-border cursor-wait'
                                : 'bg-action-surface hover:bg-action-surface-hover text-action-text border-action-border'
                            }`}
                    >
                        {action.isLoading ? (
                            <div className="w-5 h-5 border-2 border-accent-focus border-t-transparent rounded-full animate-spin"></div>
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
