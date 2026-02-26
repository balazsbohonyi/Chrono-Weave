
import React from 'react';

interface ProgressOverlayProps {
  title: string;
  subtitle?: string;
}

const ProgressOverlay: React.FC<ProgressOverlayProps> = ({ title, subtitle }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none animate-in fade-in duration-300">
      <div className="bg-white/60 backdrop-blur-xl px-12 py-8 rounded-2xl shadow-2xl border border-white/40 flex flex-col items-center gap-5 pointer-events-auto min-w-[300px] text-center">
         <div className="relative">
            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
         </div>
         <div className="flex flex-col gap-2">
             <span className="text-2xl font-bold text-gray-900 tracking-tight">{title}</span>
             {subtitle && (
                 <span className="text-base text-gray-600 font-medium uppercase tracking-wider">{subtitle}</span>
             )}
         </div>
      </div>
    </div>
  );
};

export default ProgressOverlay;
