/// <reference types="vite/client" />
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Catch benign Vite HMR WebSocket connection errors in sandbox iframe
const isViteOrWebSocketError = (err: any): boolean => {
  if (!err) return false;
  try {
    const msg = typeof err === 'string' 
      ? err 
      : (err.message || err.description || (typeof err.toString === 'function' ? err.toString() : ''));
    
    const msgLower = msg.toLowerCase();
    return (
      msgLower.includes('websocket') ||
      msgLower.includes('web socket') ||
      msgLower.includes('vite') ||
      msgLower.includes('hmr') ||
      msgLower.includes('closed without opened')
    );
  } catch (e) {
    return false;
  }
};

window.addEventListener('unhandledrejection', (event) => {
  if (isViteOrWebSocketError(event.reason)) {
    event.preventDefault();
    event.stopPropagation();
  }
});

window.addEventListener('error', (event) => {
  if (
    event.message &&
    (event.message.toLowerCase().includes('websocket') ||
      event.message.toLowerCase().includes('vite') ||
      event.message.toLowerCase().includes('closed without opened'))
  ) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);




