
import React, { useEffect } from 'react';
import { HistoricalFigure, DeepDiveData } from '../types';
import { RelationshipData } from '../App';
import { formatYear } from '../utils/formatters';

interface RelationshipPopoverProps {
  isOpen: boolean;
  source: HistoricalFigure | null;
  target: HistoricalFigure | null;
  data: RelationshipData | DeepDiveData | null;
  isLoading: boolean;
  onClose: () => void;
  mode?: 'relationship' | 'single';
}

const RelationshipPopover: React.FC<RelationshipPopoverProps> = ({
  isOpen,
  source,
  target,
  data,
  isLoading,
  onClose,
  mode = 'relationship'
}) => {
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Type Guards
  const isRelationshipData = (d: any): d is RelationshipData => mode === 'relationship' && d && 'explanation' in d;
  const isDeepDiveData = (d: any): d is DeepDiveData => mode === 'single' && d && 'famousQuote' in d;

  const renderContent = () => {
      if (isLoading) {
           return (
            <div className="flex flex-col items-center justify-center h-48 space-y-4">
              <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-500 font-sans text-lg animate-pulse">Consulting the archives...</p>
            </div>
          );
      }

      if (mode === 'relationship' && isRelationshipData(data) && data.explanation) {
          const content = data.explanation;
          return (
            <div className="animate-in slide-in-from-bottom-4 duration-500">
               {/* Summary */}
               <div className="bg-blue-50/50 p-6 rounded-lg border border-blue-100 mb-8">
                 <h3 className="text-sm font-bold uppercase text-blue-800 tracking-wider mb-2 font-sans">Relationship Summary</h3>
                 <p className="text-gray-800 text-lg font-sans leading-relaxed">{content.summary}</p>
               </div>

               {/* Sections */}
               <div className="grid grid-cols-1 gap-8">
                 {content.sections.map((section, idx) => (
                   <div key={idx} className="group">
                     <h4 className="text-xl font-sans font-bold text-gray-900 mb-2">
                       {section.title}
                     </h4>
                     <p className="text-gray-700 leading-relaxed transition-colors font-sans">
                       {section.content}
                     </p>
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
                    <div className="bg-blue-50/50 p-6 rounded-lg border border-blue-100 mb-8">
                        <h3 className="text-sm font-bold uppercase text-blue-800 tracking-wider mb-4 font-sans">Famous Quote</h3>
                        <p className="text-gray-800 text-lg italic leading-relaxed font-serif">
                            {data.famousQuote}
                        </p>
                    </div>
                )}

                {/* Sections Grid - Single Column */}
                <div className="grid grid-cols-1 gap-6">
                    {data.sections.map((section, idx) => (
                        <div key={idx} className="group">
                            <h4 className="text-xl font-sans font-bold text-gray-900 mb-2">
                                {section.title}
                            </h4>
                            <p className="text-gray-700 leading-relaxed font-sans text-base">
                                {section.content}
                            </p>
                        </div>
                    ))}
                </div>
             </div>
          );
      }

      return (
        <div className="text-center text-gray-500 italic">
          Unable to retrieve historical data.
        </div>
      );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute -top-3 -right-3 p-1.5 bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full shadow-lg border border-gray-200 transition-colors z-50"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="w-full h-full bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200">
            {/* Header Section */}
            <div className="bg-gray-50/80 border-b border-gray-200 p-6 flex-shrink-0">
                {mode === 'relationship' && source && target ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                        <FigureCard 
                            figure={source} 
                            label="Focus" 
                            color="emerald" 
                            detail={isRelationshipData(data) ? data.sourceDetail : undefined} 
                        />
                        
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-gray-200 rounded-full p-2 shadow-sm z-10 hidden md:block">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                            </svg>
                        </div>

                        <FigureCard 
                            figure={target} 
                            label="Connected To" 
                            color="blue" 
                            detail={isRelationshipData(data) ? data.targetDetail : undefined} 
                        />
                    </div>
                ) : mode === 'single' && target ? (
                    <div className="relative block w-full mb-2">
                        {/* Header Image - Floated Right */}
                        {target.imageUrl && (
                            <div className="float-right ml-6 mb-2 w-28 h-28 bg-gray-200 rounded-md overflow-hidden shadow-sm border border-gray-100">
                                <img src={target.imageUrl} alt={target.name} className="w-full h-full object-cover object-top" />
                            </div>
                        )}

                        {/* Header Text */}
                        <div className="block pt-2">
                            <div className="flex flex-wrap items-baseline gap-x-2 mb-1">
                                <h2 className="text-3xl font-bold text-gray-900 leading-tight">{target.name}</h2>
                                <span className="text-base text-gray-500 font-mono font-semibold whitespace-nowrap">
                                    {formatYear(target.birthYear)} — {formatYear(target.deathYear)}
                                </span>
                            </div>
                            <p className="text-sm text-emerald-800 font-bold uppercase tracking-wide mb-2">{target.occupation}</p>
                            
                            <p className="text-base text-gray-700 leading-relaxed font-sans max-w-2xl">
                                {target.shortDescription || (isDeepDiveData(data) ? data.summary : "Loading details...")}
                            </p>
                        </div>
                    </div>
                ) : null}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 bg-white no-scrollbar">
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
    label: string; 
    color: 'emerald' | 'blue';
    detail?: { description: string; imageUrl: string | null };
}> = ({ figure, label, color, detail }) => {
    const borderColor = color === 'emerald' ? 'border-emerald-200' : 'border-blue-200';
    const badgeColor = color === 'emerald' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800';
    const occupationColor = color === 'emerald' ? 'text-emerald-800' : 'text-blue-800';

    return (
        <div className={`bg-white rounded-xl p-5 border ${borderColor} shadow-sm relative block w-full`}>
            {/* Image Floated Right */}
            {(detail?.imageUrl || figure.imageUrl) && (
                <div className="float-right ml-4 mb-2 w-24 h-24 bg-gray-200 rounded-[10px] overflow-hidden shadow-sm border border-gray-100">
                    <img src={detail?.imageUrl || figure.imageUrl} alt={figure.name} className="w-full h-full object-cover object-top" />
                </div>
            )}

            {/* Content */}
            <div className="block">
                <span className={`inline-block mb-2 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${badgeColor}`}>
                    {label}
                </span>
                
                <div className="flex flex-wrap items-baseline gap-x-2 mt-1">
                    <h3 className="font-bold text-gray-900 text-xl leading-tight">{figure.name}</h3>
                    <span className="text-sm text-gray-500 font-mono font-semibold whitespace-nowrap">
                        {formatYear(figure.birthYear)} — {formatYear(figure.deathYear)}
                    </span>
                </div>
                
                <p className={`text-xs ${occupationColor} font-bold uppercase tracking-wide mt-1 mb-2`}>{figure.occupation}</p>
                
                <div className="text-base text-gray-800 leading-relaxed font-sans">
                    {detail ? detail.description : <span className="animate-pulse bg-gray-100 text-transparent rounded">Loading bio...</span>}
                </div>
            </div>
        </div>
    );
};

export default RelationshipPopover;
