import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global Crash Protection
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Optional: You could dispatch a custom event here to show a toast notification
});

// Suppress benign cross-origin errors from React DevTools/iframe interactions
window.addEventListener('error', (event) => {
  const msg = event.message?.toString() || '';
  const err = event.error;
  
  if (
    msg.includes('SecurityError') || 
    msg.includes('$$typeof') || 
    msg.includes('Blocked a frame with origin') ||
    (err?.name === 'SecurityError')
  ) {
    event.preventDefault();
    event.stopPropagation();
    console.warn('Suppressed known cross-origin SecurityError');
    return;
  }
});

createRoot(document.getElementById('root')!).render(
  import.meta.env.DEV ? (
    <StrictMode>
      <App />
    </StrictMode>
  ) : (
    <App />
  ),
);
