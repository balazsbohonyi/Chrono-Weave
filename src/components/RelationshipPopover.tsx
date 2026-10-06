
import React, { useLayoutEffect, useRef } from 'react';
import { HistoricalFigure, DeepDiveData } from '../types';
import { RelationshipData } from '../App';
import { formatYear } from '../utils/formatters';
import MarkdownContent from './MarkdownContent';
import { useModalFocus } from '../hooks/useModalFocus';

interface RelationshipPopoverProps {
  isOpen: boolean;
  source: HistoricalFigure | null;
  target: HistoricalFigure | null;
  data: RelationshipData | DeepDiveData | null;
  isLoading: boolean;
  onClose: () => void;
  onInspect: (figure: HistoricalFigure) => void;
  mode?: 'relationship' | 'single';
}

const RelationshipPopover: React.FC<RelationshipPopoverProps> = ({
  isOpen,
  source,
  target,
  data,
  isLoading,
  onClose,
  onInspect,
  mode = 'relationship'
}) => {
  
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const biographyReturn = useRef<{ figureId: string; scrollTop: number } | null>(null);
  useModalFocus(dialogRef, isOpen, onClose);

  useLayoutEffect(() => {
    if (!isOpen) {
      biographyReturn.current = null;
      return;
    }
    const previous = mode === 'relationship' ? biographyReturn.current : null;
    if (bodyRef.current) bodyRef.current.scrollTop = previous?.scrollTop ?? 0;
    const biographyButton = previous && [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('[data-biography-id]') ?? [])]
      .find(button => button.dataset.biographyId === previous.figureId);
    (biographyButton || dialogRef.current?.querySelector<HTMLButtonElement>('[aria-label="Close"]'))?.focus({ preventScroll: true });
    if (previous) biographyReturn.current = null;
  }, [isOpen, mode, source?.id, target?.id]);

  const openBiography = (figure: HistoricalFigure) => {
    biographyReturn.current = { figureId: figure.id, scrollTop: bodyRef.current?.scrollTop ?? 0 };
    onInspect(figure);
  };

  if (!isOpen) return null;

  // Type Guards
  const isRelationshipData = (d: any): d is RelationshipData => mode === 'relationship' && d && 'explanation' in d;
  const isDeepDiveData = (d: any): d is DeepDiveData => mode === 'single' && d && 'famousQuote' in d;

  const renderContent = () => {
      if (isLoading) {
           return (
            <div className="flex flex-col items-center justify-center h-48 space-y-4">
              <div className="w-10 h-10 border-3 border-accent-marker border-t-transparent rounded-full animate-spin"></div>
              <p className="text-content-muted font-sans text-lg animate-pulse">Consulting the archives...</p>
            </div>
          );
      }

      if (mode === 'relationship' && isRelationshipData(data) && data.explanation) {
          const content = data.explanation;
          return (
            <div className="animate-in slide-in-from-bottom-4 duration-500">
               {/* Summary */}
               <div className="bg-summary-surface/50 p-6 rounded-lg border border-summary-border mb-8">
                 <h3 className="text-sm font-bold uppercase text-accent-heading tracking-wider mb-2 font-sans">Relationship Summary</h3>
                 <MarkdownContent className="text-summary-text text-lg font-sans leading-relaxed">{content.summary}</MarkdownContent>
               </div>

               {/* Sections */}
               <div className="grid grid-cols-1 gap-8">
                 {content.sections.map((section, idx) => (
                   <div key={idx} className="group">
                     <h4 className="text-xl font-sans font-bold text-content-primary mb-2">
                       <MarkdownContent inline>{section.title}</MarkdownContent>
                     </h4>
                     <MarkdownContent className="text-content-body leading-relaxed transition-colors font-sans">
                       {section.content}
                     </MarkdownContent>
                   </div>
                 ))}
               </div>
            </div>
          );
      }

      if (mode === 'single' && isDeepDiveData(data)) {
          return (
             <div className="animate-in slide-in-from-bottom-4 duration-500">
                {/* Famous Quote */}
                {data.famousQuote && (
                    <div className="bg-summary-surface/50 p-6 rounded-lg border border-summary-border mb-8">
                        <h3 className="text-sm font-bold uppercase text-accent-heading tracking-wider mb-4 font-sans">Famous Quote</h3>
                        <MarkdownContent className="text-summary-text text-lg italic leading-relaxed font-serif">
                            {data.famousQuote}
                        </MarkdownContent>
                    </div>
                )}

                {/* Sections Grid - Single Column */}
                <div className="grid grid-cols-1 gap-6">
                    {data.sections.map((section, idx) => (
                        <div key={idx} className="group">
                            <h4 className="text-xl font-sans font-bold text-content-primary mb-2">
                                <MarkdownContent inline>{section.title}</MarkdownContent>
                            </h4>
                            <MarkdownContent className="text-content-body leading-relaxed font-sans text-base">
                                {section.content}
                            </MarkdownContent>
                        </div>
                    ))}
                </div>
             </div>
          );
      }

      return (
        <div className="text-center text-content-muted italic">
          Unable to retrieve historical data.
        </div>
      );
  };

  return (
    <div
      className="relationship-detail-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'relationship' ? 'Relationship explanation' : 'Historical details'}
        className="relative w-full max-w-5xl max-h-[90vh] flex flex-col"
      >
        
        {/* Close Button */}
        <button 
          type="button"
          onClick={onClose}
          className="close-button absolute -top-3 -right-3 z-50"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="w-full h-full bg-surface rounded-xl shadow-2xl flex flex-col overflow-hidden border border-border">
            {/* Header Section */}
            <div className="bg-surface-dialog-header/80 border-b border-border p-6 flex-shrink-0">
                {mode === 'relationship' && source && target ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                        <FigureCard 
                            figure={source} 
                            color="emerald" 
                            detail={isRelationshipData(data) ? data.sourceDetail : undefined} 
                            onInspect={openBiography}
                            disabled={isLoading}
                        />
                        
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-connector border border-connector-border rounded-full p-2 shadow-sm z-10 hidden md:block">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-accent-marker" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                            </svg>
                        </div>

                        <FigureCard 
                            figure={target} 
                            color="blue" 
                            detail={isRelationshipData(data) ? data.targetDetail : undefined} 
                            onInspect={openBiography}
                            disabled={isLoading}
                        />
                    </div>
                ) : mode === 'single' && target ? (
                    <div className={`grid grid-cols-1 gap-6 items-start ${target.imageUrl
                        ? 'md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_7rem]'
                        : 'md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]'}`}>
                        <div className="min-w-0 space-y-2">
                            <h2 className="text-2xl font-bold text-content-primary leading-tight break-words">{target.name}</h2>
                            <p className="text-sm text-success-heading font-bold uppercase tracking-wide">{target.occupation}</p>
                            <p className="text-base text-content-muted font-mono font-semibold">
                                    {formatYear(target.birthYear)} — {formatYear(target.deathYear)}
                            </p>
                        </div>

                        <MarkdownContent className="min-w-0 text-base text-content-body leading-relaxed font-sans">
                            {target.shortDescription || (isDeepDiveData(data) ? data.summary : "Loading details...")}
                        </MarkdownContent>

                        {target.imageUrl && (
                            <div className="w-28 h-28 bg-surface-placeholder rounded-md overflow-hidden shadow-sm border border-border-subtle">
                                <img src={target.imageUrl} alt={target.name} className="w-full h-full object-cover object-top" />
                            </div>
                        )}
                    </div>
                ) : null}
            </div>

            {/* Body */}
            <div ref={bodyRef} className="flex-1 overflow-y-auto p-6 bg-surface no-scrollbar">
                {renderContent()}
                <div className="h-4"></div>
            </div>
        </div>
      </div>
    </div>
  );
};

const FigureCard: React.FC<{ 
    figure: HistoricalFigure; 
    color: 'emerald' | 'blue';
    detail?: { description: string; imageUrl: string | null };
    onInspect: (figure: HistoricalFigure) => void;
    disabled: boolean;
}> = ({ figure, color, detail, onInspect, disabled }) => {
    const borderColor = color === 'emerald' ? 'border-card-source-border' : 'border-card-target-border';
    const occupationColor = color === 'emerald' ? 'text-success-heading' : 'text-accent-heading';

    return (
        <div className={`bg-surface-card rounded-xl p-5 border ${borderColor} shadow-sm relative block w-full group`}>
            {/* Image Floated Right */}
            {(detail?.imageUrl || figure.imageUrl) && (
                <div className="float-right ml-4 mb-2 w-24 h-24 bg-surface-placeholder rounded-[10px] overflow-hidden shadow-sm border border-border-subtle">
                    <img src={detail?.imageUrl || figure.imageUrl} alt={figure.name} className="w-full h-full object-cover object-top" />
                </div>
            )}

            {/* Content */}
            <div className="block">
                <div className="flex flex-wrap items-baseline gap-x-2 mt-1">
                    <h3 className="font-bold text-content-primary text-xl leading-tight">{figure.name}</h3>
                    <span className="text-sm text-card-muted font-mono font-semibold whitespace-nowrap">
                        {formatYear(figure.birthYear)} — {formatYear(figure.deathYear)}
                    </span>
                </div>
                
                <p className={`text-xs ${occupationColor} font-bold uppercase tracking-wide mt-1 mb-2`}>{figure.occupation}</p>
                
                <div className="text-base text-content-heading leading-relaxed font-sans">
                    {detail ? <MarkdownContent>{detail.description}</MarkdownContent> : <span className="animate-pulse bg-surface-muted text-transparent rounded">Loading bio...</span>}
                </div>
            </div>
            <div className="absolute bottom-2 right-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity duration-300 z-10">
                <button
                    type="button"
                    data-biography-id={figure.id}
                    aria-label={`Read biography of ${figure.name}`}
                    title={`Read biography of ${figure.name}`}
                    disabled={disabled}
                    className="p-2 rounded-lg border border-action-border bg-action-surface/60 text-action-text hover:bg-action-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-marker disabled:opacity-40 disabled:cursor-wait transition-colors"
                    onClick={() => onInspect({ ...figure, imageUrl: detail?.imageUrl || figure.imageUrl, shortDescription: figure.shortDescription || detail?.description })}
                >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.25v13.5m0-13.5C10.8 5.48 9.25 5 7.5 5S4.17 5.48 3 6.25v13.5C4.17 18.98 5.75 18.5 7.5 18.5s3.3.48 4.5 1.25m0-13.5C13.2 5.48 14.75 5 16.5 5s3.33.48 4.5 1.25v13.5c-1.17-.77-2.75-1.25-4.5-1.25s-3.3.48-4.5 1.25" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default RelationshipPopover;
