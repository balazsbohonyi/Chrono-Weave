import React, { createContext, useContext, ReactNode } from 'react';

interface AppConfig {
    provider: string;
    apiKey: string;
    model: string;
}

interface EnvironmentContextType {
    isProduction: boolean;
    getEffectiveConfig: () => AppConfig;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(undefined);

export const EnvironmentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // @ts-ignore - APP_MODE is defined in vite.config.ts
    const isProduction = process.env.APP_MODE === 'production';

    const getEffectiveConfig = (): AppConfig => {
        // Helper to get the appropriate default model based on provider
        const getDefaultModel = (provider: string): string => {
            return provider === 'openrouter' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash';
        };

        // Both development and production modes now prioritize localStorage for flexibility
        // This allows runtime configuration changes via the Settings dialog
        const localProvider = localStorage.getItem('chrono_provider');
        const localKey = localStorage.getItem('chrono_api_key');
        const localModel = localStorage.getItem('chrono_model');

        if (localProvider && localKey && localModel) {
            return { provider: localProvider, apiKey: localKey, model: localModel };
        }

        // Fallback to environment variables if localStorage is not set
        const provider = process.env.PROVIDER || 'gemini';
        return {
            provider,
            apiKey: process.env.API_KEY || '',
            model: process.env.MODEL || getDefaultModel(provider)
        };
    };

    return (
        <EnvironmentContext.Provider value={{ isProduction, getEffectiveConfig }}>
            {children}
        </EnvironmentContext.Provider>
    );
};

export const useEnvironment = () => {
    const context = useContext(EnvironmentContext);
    if (context === undefined) {
        throw new Error('useEnvironment must be used within an EnvironmentProvider');
    }
    return context;
};
