import React, { useState, useEffect } from 'react';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  onShowToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose, onSave, onShowToast }) => {
  const [provider, setProvider] = useState<string>('gemini');
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [currentConfig, setCurrentConfig] = useState<{
    provider: string;
    model: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Load settings from localStorage
      const storedProvider = localStorage.getItem('chrono_provider') || 'gemini';
      const storedApiKey = localStorage.getItem('chrono_api_key') || '';
      const storedModel = localStorage.getItem('chrono_model') || '';

      setProvider(storedProvider);
      setApiKey(storedApiKey);

      // If no model in localStorage, use provider-specific defaults
      if (storedModel) {
        setModel(storedModel);
      } else {
        // Set default model based on provider
        setModel(storedProvider === 'gemini' ? 'gemini-2.5-flash' : 'openai/gpt-oss-120b');
      }

      // Load current effective config from environment
      setCurrentConfig({
        provider: process.env.PROVIDER || 'gemini',
        model: process.env.MODEL || 'gemini-2.5-flash'
      });
    }
  }, [isOpen]);

  // Validation check
  const isFormValid = provider && apiKey.trim() !== '' && model.trim() !== '';

  const handleTest = async () => {
    if (!isFormValid) return;

    setIsTesting(true);

    try {
      // Dynamically create temporary service instance for testing
      let testService;
      if (provider === 'gemini') {
        const { GeminiService } = await import('../services/geminiService');
        testService = new GeminiService(apiKey, model);
      } else {
        const { OpenRouterService } = await import('../services/openRouterService');
        testService = new OpenRouterService(apiKey, model);
      }

      const result = await testService.testConnection();

      if (result.success) {
        onShowToast(
          `Connection successful to ${provider === 'gemini' ? 'Google Gemini' : 'OpenRouter'}`,
          'success'
        );
      } else {
        onShowToast(`Connection failed: ${result.error}`, 'error');
      }
    } catch (error: any) {
      onShowToast(`Test failed: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      setIsTesting(false);
    }
  };

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
    return provider === 'gemini' ? 'gemini-2.5-flash' : 'openai/gpt-oss-120b';
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

        {currentConfig && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
            <p className="text-sm text-gray-700">
              <span className="font-medium">Currently using:</span> {
                currentConfig.provider === 'gemini' ? 'Google Gemini' : 'OpenRouter'
              } with model <span className="font-mono text-xs bg-white px-2 py-0.5 rounded border border-gray-200">{currentConfig.model}</span>
            </p>
          </div>
        )}

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AI Provider</label>
            <select
              value={provider}
              onChange={(e) => {
                const newProvider = e.target.value;
                setProvider(newProvider);

                // If model field is currently a default value or empty, switch to new provider's default
                const currentModel = model.trim();
                if (!currentModel || currentModel === 'gemini-2.5-flash' || currentModel === 'openai/gpt-oss-120b') {
                  setModel(newProvider === 'gemini' ? 'gemini-2.5-flash' : 'openai/gpt-oss-120b');
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
              Get your API key from {getApiKeyLink()}.
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
            onClick={handleTest}
            disabled={!isFormValid || isTesting}
            className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isTesting ? 'Testing...' : 'Test'}
          </button>
          <button
            onClick={handleSave}
            disabled={!isFormValid}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save & Reload
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
