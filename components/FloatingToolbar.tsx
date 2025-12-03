
import React from 'react';
import { InteractionMode } from '../types';

interface FloatingToolbarProps {
  mode: InteractionMode;
  setMode: (mode: InteractionMode) => void;
  onResetZoom: () => void;
}

const FloatingToolbar: React.FC<FloatingToolbarProps> = ({ mode, setMode, onResetZoom }) => {
  const tools = [
    { 
      id: 'select', 
      label: 'Select', 
      // Arrow/Pointer
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
           <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
           <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
        </svg>
      ),
      shortcut: 'S' 
    },
    { 
      id: 'pan', 
      label: 'Panning', 
      // Hand
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
        </svg>
      ),
      shortcut: 'P' 
    },
    { 
      id: 'zoom', 
      label: 'Zoom', 
      // Magnifying Glass
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
        </svg>
      ),
      shortcut: 'Z' 
    }
  ];

  return (
    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-white/60 backdrop-blur-xl p-1.5 rounded-xl border border-white/40 shadow-xl ring-1 ring-black/5 animate-in slide-in-from-bottom-6 fade-in duration-300">
        {tools.map((tool) => (
             <button
                key={tool.id}
                onClick={() => setMode(tool.id as InteractionMode)}
                className={`relative w-12 h-12 flex items-center justify-center rounded-lg transition-all duration-200 group outline-none ${mode === tool.id ? 'bg-white shadow-sm text-blue-600 ring-1 ring-black/5' : 'text-gray-500 hover:bg-black/5 hover:text-gray-900'}`}
                title={`${tool.label} (${tool.shortcut})`}
             >
                {tool.icon}
                <span className="absolute bottom-1 right-1.5 text-[9px] font-bold opacity-60 font-mono leading-none">{tool.shortcut}</span>
             </button>
        ))}
        
        <div className="w-px h-6 bg-gray-400/30 mx-1"></div>

        <button
             onClick={onResetZoom}
             className="relative w-12 h-12 flex items-center justify-center rounded-lg transition-all duration-200 text-gray-500 hover:bg-black/5 hover:text-gray-900 outline-none"
             title="Reset Zoom (R)"
        >
             <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
             </svg>
             <span className="absolute bottom-1 right-1.5 text-[9px] font-bold opacity-60 font-mono leading-none">R</span>
        </button>
    </div>
  );
};

export default FloatingToolbar;
