import React, { useEffect, useState } from 'react';

interface ToastProps {
  message: string | null;
  type?: 'success' | 'info' | 'error';
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type = 'info', onClose }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onClose, 300); // Wait for fade out
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [message, onClose]);

  if (!message) return null;

  const styleClasses = {
    success: 'bg-white text-gray-900 border-emerald-500',
    info: 'bg-white text-blue-900 border-blue-500',
    error: 'bg-white text-red-600 border-red-500'
  };

  const iconColors = {
    success: 'text-emerald-600',
    info: 'text-blue-600',
    error: 'text-red-600'
  };

  return (
    <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 pointer-events-none ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
      <div className={`${styleClasses[type]} border-l-4 px-6 py-3 rounded-r-lg shadow-2xl flex items-center gap-3 pointer-events-auto border-t border-r border-b border-gray-100`}>
        {type === 'success' && (
            <svg className={`w-5 h-5 shrink-0 ${iconColors.success}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
        )}
        {type === 'error' && (
            <svg className={`w-5 h-5 shrink-0 ${iconColors.error}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        )}
        {type === 'info' && (
            <svg className={`w-5 h-5 shrink-0 ${iconColors.info}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        )}
        <span className="font-medium text-sm leading-tight">{message}</span>
      </div>
    </div>
  );
};

export default Toast;