
import React, { useState, useEffect } from 'react';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose, onSave }) => {
  const [provider, setProvider] = useState<string>('gemini');
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      // Fallback to Google Gemini if no settings in local storage
      const storedProvider = localStorage.getItem('chrono_provider') || 'gemini';
      setProvider(storedProvider);
      
      // Load OpenRouter settings if they exist (even if current provider is Gemini, so we can switch back easily)
      setApiKey(localStorage.getItem('chrono_openrouter_key') || '');
      setModel(localStorage.getItem('chrono_openrouter_model') || 'anthropic/claude-3.5-sonnet');
    }
  }, [isOpen]);

  const handleSave = () => {
    // Check for changes before saving
    const currentStoredProvider = localStorage.getItem('chrono_provider') || 'gemini';
    const currentStoredKey = localStorage.getItem('chrono_openrouter_key') || '';
    const currentStoredModel = localStorage.getItem('chrono_openrouter_model') || 'anthropic/claude-3.5-sonnet';

    const hasChanges =
        provider !== currentStoredProvider ||
        // Check key/model changes regardless of provider to ensure they are saved if edited
        apiKey !== currentStoredKey || 
        model !== currentStoredModel;

    localStorage.setItem('chrono_provider', provider);
    
    // Always save keys if they are present, so user doesn't lose them when switching providers
    if (apiKey) localStorage.setItem('chrono_openrouter_key', apiKey);
    if (model) localStorage.setItem('chrono_openrouter_model', model);
    
    // Notify parent to reload services and data if changes occurred that affect the active service
    const needsReload = 
        provider !== currentStoredProvider ||
        (provider === 'openrouter' && (apiKey !== currentStoredKey || model !== currentStoredModel));

    if (needsReload) {
        onSave();
        onClose();
    } else {
        onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-800">AI Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AI Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full h-10 px-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">Select the backend service to power ChronoWeave.</p>
          </div>

          <div className={`transition-opacity duration-200 ${provider === 'gemini' ? 'opacity-50 pointer-events-none grayscale' : 'opacity-100'}`}>
             <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">OpenRouter API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-..."
                  className="w-full h-10 px-3 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                  // Don't disable input completely so users can edit it even if 'Gemini' is selected (for preparation)
                  // but visually it is greyed out via parent opacity
                />
             </div>
             <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Model ID</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. anthropic/claude-3-opus"
                  className="w-full h-10 px-3 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">Full model string ID from OpenRouter docs.</p>
             </div>
          </div>
        </div>

        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
          >
            Save & Reload
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
