import React, { useEffect, useRef, useState } from 'react';
import { useEnvironment } from '../contexts/EnvironmentContext';
import { createAIService } from '../services/aiService';
import { OllamaService } from '../services/ollamaService';
import {
  AppConfig, AIProvider, OllamaMode, defaultModel, isConfigValid, providerNames,
  readProviderConfig, saveProviderConfig, settingsKey,
} from '../utils/providerConfig';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  onShowToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

const fieldClass = 'w-full h-10 px-3 border border-border-strong rounded-md focus:ring-2 focus:ring-accent-marker outline-none bg-surface';
const configLabel = (config: AppConfig) => providerNames[config.provider] +
  (config.provider === 'ollama' ? config.ollamaMode === 'cloud' ? ' Cloud' : ' (local server)' : '');

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose, onSave, onShowToast }) => {
  const { getEffectiveConfig } = useEnvironment();
  const [form, setForm] = useState<AppConfig>(() => getEffectiveConfig());
  const [currentConfig, setCurrentConfig] = useState<AppConfig>(form);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [manualModel, setManualModel] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [listError, setListError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [hasEnvironmentKey, setHasEnvironmentKey] = useState(false);
  const [relayError, setRelayError] = useState('');
  const drafts = useRef<Record<string, AppConfig>>({});
  const testVersion = useRef(0);
  const testController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const config = getEffectiveConfig();
    drafts.current = {};
    setForm(config);
    setCurrentConfig(config);
    setManualModel(false);
  }, [isOpen, getEffectiveConfig]);

  useEffect(() => {
    testVersion.current++;
    testController.current?.abort();
    setIsTesting(false);
    setTestResult(null);
    return () => { testVersion.current++; testController.current?.abort(); };
  }, [form, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    setHasEnvironmentKey(false);
    setRelayError('');
    if (!isOpen || form.provider !== 'ollama' || form.ollamaMode !== 'cloud') return;
    const controller = new AbortController();
    OllamaService.hasEnvironmentKey(controller.signal).then(hasKey => {
      if (!controller.signal.aborted) setHasEnvironmentKey(hasKey);
    }).catch(error => {
      if (!controller.signal.aborted) setRelayError(error instanceof Error ? error.message : 'Cannot reach the cloud relay.');
    });
    return () => controller.abort();
  }, [isOpen, form.provider, form.ollamaMode]);

  useEffect(() => {
    setModels([]);
    setListError('');
    setIsListing(false);
    if (!isOpen || form.provider !== 'ollama') return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsListing(true);
      try {
        const names = await new OllamaService(form).listModels(controller.signal);
        if (!controller.signal.aborted) setModels(names);
      } catch (error) {
        if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : 'Could not load models.');
      } finally { if (!controller.signal.aborted) setIsListing(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
    // Model edits do not require fetching the catalog again.
  }, [isOpen, form.provider, form.ollamaMode, form.baseUrl, form.apiKey, refresh]);

  const switchProfile = (provider: AIProvider, mode: OllamaMode = form.ollamaMode) => {
    drafts.current[settingsKey(form.provider, form.ollamaMode)] = form;
    setManualModel(false);
    setForm(drafts.current[settingsKey(provider, mode)] || readProviderConfig(provider, mode, localStorage));
  };
  const update = (fields: Partial<AppConfig>) => setForm(previous => ({ ...previous, ...fields }));
  const isValid = isConfigValid(form, hasEnvironmentKey);

  const handleTest = async () => {
    if (!isValid) return;
    const version = ++testVersion.current;
    const controller = new AbortController();
    testController.current = controller;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await createAIService(form).testConnection(controller.signal);
      if (testVersion.current !== version || controller.signal.aborted) return;
      setTestResult({ success: result.success, message: result.success
        ? `Connection successful to ${configLabel(form)} using ${form.model}.`
        : `Connection failed: ${result.error || 'The provider did not return a usable response.'}` });
    } catch (error) {
      if (testVersion.current === version) setTestResult({ success: false, message: error instanceof Error ? error.message : 'Connection test failed.' });
    } finally {
      if (testVersion.current === version) setIsTesting(false);
    }
  };

  const cancelTest = () => {
    testVersion.current++;
    testController.current?.abort();
    setIsTesting(false);
    setTestResult({ success: false, message: 'Connection test cancelled.' });
  };

  const handleSave = () => {
    if (!isValid) return;
    try {
      saveProviderConfig(form, localStorage);
      onSave();
      onClose();
    } catch (error) { onShowToast(error instanceof Error ? error.message : 'Could not save settings.', 'error'); }
  };

  if (!isOpen) return null;
  const isOllama = form.provider === 'ollama';
  const isCloud = isOllama && form.ollamaMode === 'cloud';
  const keyUrl = isCloud ? 'https://ollama.com/settings/keys'
    : form.provider === 'gemini' ? 'https://aistudio.google.com/apikey' : 'https://openrouter.ai/keys';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay/50 backdrop-blur-sm p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="bg-surface rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="bg-surface-subtle px-6 py-4 border-b border-border flex justify-between items-center shrink-0">
          <h2 id="settings-title" className="text-lg font-bold text-content-heading">AI Settings</h2>
          <button type="button" aria-label="Close settings" onClick={onClose} className="close-button">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-3 bg-accent-softest border-b border-accent-soft text-sm text-content-body shrink-0">
          <span className="font-medium">Currently using:</span> {configLabel(currentConfig)} with model{' '}
          <span className="font-mono text-xs break-all">{currentConfig.model}</span>
        </div>
        <div className="min-h-0 overflow-y-auto">
        <div className="p-6 space-y-5">
          <div>
            <label htmlFor="ai-provider" className="block text-sm font-medium text-content-body mb-1">AI Provider</label>
            <select id="ai-provider" value={form.provider} onChange={event => switchProfile(event.target.value as AIProvider)} className={fieldClass}>
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          {isOllama && (
            <div>
              <label htmlFor="ollama-mode" className="block text-sm font-medium text-content-body mb-1">Ollama connection</label>
              <select id="ollama-mode" value={form.ollamaMode} onChange={event => switchProfile('ollama', event.target.value as OllamaMode)} className={fieldClass}>
                <option value="local">Local server</option>
                <option value="cloud">Ollama Cloud</option>
              </select>
              <p className="text-xs text-content-muted mt-1">{isCloud ? 'Connect to Ollama Cloud using your API key.' : 'Use local models or cloud models through your signed-in Ollama installation.'}</p>
            </div>
          )}
          {isOllama && !isCloud && (
            <div>
              <label htmlFor="ollama-url" className="block text-sm font-medium text-content-body mb-1">Ollama server URL</label>
              <input id="ollama-url" type="url" value={form.baseUrl} onChange={event => update({ baseUrl: event.target.value })} placeholder="http://localhost:11434" className={fieldClass} />
              <p className="text-xs text-content-muted mt-1">No API key is required. Start Ollama and sign in there to use cloud models.</p>
            </div>
          )}
          {(!isOllama || isCloud) && (
            <div>
              <label htmlFor="ai-key" className="block text-sm font-medium text-content-body mb-1">{configLabel(form)} API Key</label>
              <input id="ai-key" type="password" autoComplete="off" value={form.apiKey} onChange={event => update({ apiKey: event.target.value })} placeholder={isCloud && hasEnvironmentKey ? 'Server API key configured (optional override)' : 'Enter your API key'} className={fieldClass} />
              <p className="text-xs text-content-muted mt-1">
                Get a key from <a href={keyUrl} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">{isCloud ? 'Ollama' : providerNames[form.provider]}</a>.
              </p>
              {isCloud && <p className="text-xs text-content-muted mt-1">Your key is saved in this browser when you click Save. {hasEnvironmentKey && 'Leave blank to use the server’s configured key.'}</p>}
              {isCloud && relayError && <p role="status" className="text-xs text-danger-text mt-1">{relayError}</p>}
            </div>
          )}
          <div>
            <label htmlFor="ai-model" className="block text-sm font-medium text-content-body mb-1">Model ID</label>
            {isOllama ? (
              <>
                <select id="ai-model" value={manualModel ? '' : form.model} onChange={event => {
                  setManualModel(event.target.value === '');
                  if (event.target.value) update({ model: event.target.value });
                }} className={fieldClass}>
                  {form.model && !models.includes(form.model) && <option value={form.model}>{form.model} (current model)</option>}
                  {models.map(name => <option key={name} value={name}>{name}</option>)}
                  <option value="">Enter a model ID manually...</option>
                </select>
                {(manualModel || !form.model) && (
                  <div className="mt-2">
                    <label htmlFor="ai-custom-model" className="block text-sm font-medium text-content-body mb-1">Custom model ID</label>
                    <input id="ai-custom-model" type="text" value={form.model} onChange={event => update({ model: event.target.value })} placeholder={defaultModel(form.provider, form.ollamaMode)} className={fieldClass} />
                  </div>
                )}
                <div className="flex justify-between items-center gap-2 mt-2">
                  <span role="status" className="text-xs text-content-muted">{isListing ? 'Loading models…' : `${models.length} models available. You can also enter a name.`}</span>
                  <button onClick={() => setRefresh(value => value + 1)} disabled={isListing} className="text-sm text-accent-text hover:underline disabled:opacity-50">Refresh models</button>
                </div>
                {listError && <p role="status" className="text-xs text-danger-text mt-2">{listError}</p>}
                {isCloud && <p className="text-xs text-content-muted mt-1">Use the cloud catalog’s exact model ID; local “-cloud” aliases can differ.</p>}
              </>
            ) : <>
              <input id="ai-model" type="text" value={form.model} onChange={event => update({ model: event.target.value })} placeholder={defaultModel(form.provider)} className={fieldClass} />
              <p className="text-xs text-content-muted mt-1">Default: {defaultModel(form.provider)}</p>
            </>}
          </div>
          {isOllama && <div>
            <label htmlFor="ollama-reasoning" className="flex items-center gap-2 text-sm font-medium text-content-body">
              <input id="ollama-reasoning" type="checkbox" checked={form.ollamaReasoning === true} onChange={event => update({ ollamaReasoning: event.target.checked })} className="h-4 w-4 accent-accent-solid" />
              Enable reasoning
            </label>
            <p className="text-xs text-content-muted mt-1">Off by default for faster replies. Enable for harder questions with a model that supports reasoning. GPT-OSS always reasons: off uses low effort, on uses medium effort.</p>
          </div>}
        </div>
        {(isTesting || testResult) && <div role="status" aria-live="polite" className={`mx-6 mb-4 p-3 rounded-md text-sm break-words ${testResult?.success ? 'bg-success-soft text-success-heading' : testResult ? 'bg-danger-soft text-danger-heading' : 'bg-accent-softest text-accent-heading'}`}>
          {isTesting ? `Waiting for ${form.model} to generate a test response. ${isCloud ? 'The cloud test stops after 60 seconds.' : 'This can take up to three minutes, including model loading.'}` : testResult?.message}
        </div>}
        </div>
        <div className="bg-surface-subtle px-6 py-4 border-t border-border flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-content-body hover:bg-surface-muted rounded-md">Cancel</button>
          <button onClick={isTesting ? cancelTest : handleTest} disabled={!isValid && !isTesting} className="px-4 py-2 text-sm text-accent-text-hover bg-accent-softest rounded-md disabled:opacity-50 disabled:cursor-not-allowed">{isTesting ? 'Stop test' : 'Test connection'}</button>
          <button onClick={handleSave} disabled={!isValid || isTesting} className="px-4 py-2 text-sm text-on-accent bg-accent-solid rounded-md disabled:opacity-50 disabled:cursor-not-allowed">Save</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
