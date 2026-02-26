import App from '@/App';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { EnvironmentProvider } from './contexts/EnvironmentContext';
import './styles/globals.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <EnvironmentProvider>
      <App />
    </EnvironmentProvider>
  </React.StrictMode>
);