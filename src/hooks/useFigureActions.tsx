import React from 'react';
import { HistoricalFigure } from '../types';

export interface ActionItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: (e: React.MouseEvent) => void;
    isLoading: boolean;
    isVisible: boolean;
}

interface UseFigureActionsProps {
    figure: HistoricalFigure;
    onDiscover: (figure: HistoricalFigure) => void;
    onTrace: (figure: HistoricalFigure, clientY: number) => void;
    onInspect: (figure: HistoricalFigure) => void;
    isDiscovering: boolean;
    isTracing?: boolean;
}

export const useFigureActions = ({
    figure,
    onDiscover,
    onTrace,
    onInspect,
    isDiscovering,
    isTracing = false
}: UseFigureActionsProps): ActionItem[] => {
    const isEvent = figure.category === 'EVENTS';

    const actions: (ActionItem | null)[] = [
        {
            id: 'inspect',
            label: isEvent ? "Read Details" : "Read Biography",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
            ),
            onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                onInspect(figure);
            },
            isLoading: false,
            isVisible: true
        },
        !isEvent ? {
            id: 'trace',
            label: "Map Relationships",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
            ),
            onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                onTrace(figure, e.clientY);
            },
            isLoading: isTracing,
            isVisible: true
        } : null,
        !isEvent ? {
            id: 'discover',
            label: "Expand Timeline",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
            ),
            onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                onDiscover(figure);
            },
            isLoading: isDiscovering,
            isVisible: true
        } : null
    ];

    return actions.filter((item): item is ActionItem => item !== null && item.isVisible);
};
