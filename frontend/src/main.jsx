import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LocaleProvider } from './locale';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(<LocaleProvider><App /></LocaleProvider>);

// PWA shell only; movies are never cached by the service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
