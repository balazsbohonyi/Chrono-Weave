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
      // Load settings from generic keys
      const storedProvider = localStorage.getItem('chrono_provider') || 'gemini';
      setProvider(storedProvider);
      setApiKey(localStorage.getItem('chrono_api_key') || '');
      setModel(localStorage.getItem('chrono_model') || 'gemini-2.5-flash');
    }
  }, [isOpen]);

  const handleSave = () => {
    // Check for changes before saving
    const currentStoredProvider = localStorage.getItem('chrono_provider') || 'gemini';
    const currentStoredKey = localStorage.getItem('chrono_api_key') || '';
    const currentStoredModel = localStorage.getItem('chrono_model') || 'gemini-2.5-flash';

    localStorage.setItem('chrono_provider', provider);

    if (apiKey) localStorage.setItem('chrono_api_key', apiKey);
    else localStorage.removeItem('chrono_api_key');

    if (model) localStorage.setItem('chrono_model', model);
    else localStorage.removeItem('chrono_model');

    // Notify parent to reload services and data if changes occurred
    const needsReload =
      provider !== currentStoredProvider ||
      apiKey !== currentStoredKey ||
      model !== currentStoredModel;

    if (needsReload) {
      onSave();
      onClose();
    } else {
      onClose();
    }
  };

  // Helper to get default model placeholder based on provider
  const getModelPlaceholder = () => {
    return provider === 'gemini' ? 'gemini-2.5-flash' : 'anthropic/claude-3.5-sonnet';
  };

  // Helper to get API key link
  const getApiKeyLink = () => {
    if (provider === 'gemini') {
      return <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google AI Studio</a>;
    }
    return <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OpenRouter</a>;
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
              onChange={(e) => {
                setProvider(e.target.value);
                // Keep user input, but maybe set default if empty?
                if (!model) {
                  setModel(e.target.value === 'gemini' ? 'gemini-2.5-flash' : 'anthropic/claude-3.5-sonnet');
                }
              }}
              className="w-full h-10 px-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">Select the backend service to power ChronoWeave.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {provider === 'gemini' ? 'Google Gemini API Key' : 'OpenRouter API Key'}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'gemini' ? "Google Gemini API Key" : "OpenRouter API Key"}
              className="w-full h-10 px-3 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <div className="text-xs text-gray-500 mt-1">
              {apiKey ? (
                process.env.API_KEY && process.env.PROVIDER === provider ? (
                  <span className="text-amber-600">⚠ Overriding .env.local key</span>
                ) : (
                  <span>Get your API key from {getApiKeyLink()}.</span>
                )
              ) : (
                process.env.API_KEY && process.env.PROVIDER === provider ? (
                  <span className="text-green-600">✓ Using API key from .env.local file</span>
                ) : (
                  <span>Get your API key from {getApiKeyLink()}.</span>
                )
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Model ID</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={getModelPlaceholder()}
              className="w-full h-10 px-3 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              {provider === 'gemini' ? 'Default: gemini-2.5-flash' : 'Full model string ID from OpenRouter docs.'}
            </p>
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
