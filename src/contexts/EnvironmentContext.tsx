import React, { createContext, useContext, ReactNode } from 'react';
import { AppConfig, getEffectiveConfig as readEffectiveConfig } from '../utils/providerConfig';

interface EnvironmentContextType {
    isProduction: boolean;
    getEffectiveConfig: () => AppConfig;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(undefined);

export const EnvironmentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // @ts-ignore - APP_MODE is defined in vite.config.ts
    const isProduction = process.env.APP_MODE === 'production';

    const getEffectiveConfig = React.useCallback((): AppConfig => readEffectiveConfig(localStorage), []);

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
