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
        // In production, strictly use environment variables (injected at build time or runtime if configured)
        // We ignore localStorage to prevent user overrides in production
        if (isProduction) {
            return {
                provider: process.env.PROVIDER || 'gemini',
                apiKey: process.env.API_KEY || '',
                model: process.env.MODEL || 'gemini-2.5-flash'
            };
        }

        // In development, prioritize localStorage for easier testing/switching
        const localProvider = localStorage.getItem('chrono_provider');
        const localKey = localStorage.getItem('chrono_api_key');
        const localModel = localStorage.getItem('chrono_model');

        if (localProvider && localKey && localModel) {
            return { provider: localProvider, apiKey: localKey, model: localModel };
        }

        return {
            provider: process.env.PROVIDER || 'gemini',
            apiKey: process.env.API_KEY || '',
            model: process.env.MODEL || 'gemini-2.5-flash'
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
