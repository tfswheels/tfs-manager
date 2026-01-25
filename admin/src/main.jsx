import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from '@shopify/app-bridge-react';
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

// Get shop and host from URL parameters or storage
const urlParams = new URLSearchParams(window.location.search);
const shop = urlParams.get('shop') ||
              sessionStorage.getItem('shopify_shop') ||
              localStorage.getItem('shopify_shop') ||
              '2f3d7a-2.myshopify.com'; // Default shop for testing
const host = urlParams.get('host') ||
              sessionStorage.getItem('shopify_host') ||
              localStorage.getItem('shopify_host') ||
              btoa(`${shop}/admin`); // Generate host if missing

// App Bridge configuration
const config = {
  apiKey: apiKey || 'test-api-key',
  host: host,
  forceRedirect: false
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider config={config}>
      <App />
    </Provider>
  </React.StrictMode>
);
