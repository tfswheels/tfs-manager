import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@shopify/polaris/build/esm/styles.css';
import './index.css';
import './styles/embedded.css';

// Inject Shopify API key into meta tag for App Bridge
const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY;
if (apiKey) {
  const metaTag = document.querySelector('meta[name="shopify-api-key"]');
  if (metaTag) {
    metaTag.setAttribute('content', apiKey);
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
