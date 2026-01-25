import React, { useEffect } from 'react';
import { useAppBridge } from '@shopify/app-bridge-react';
import { useLocation } from 'react-router-dom';

export default function AppBridgeProvider({ children }) {
  const location = useLocation();
  const app = useAppBridge();

  // Check URL directly first (more reliable on initial render than useLocation)
  const urlParams = new URLSearchParams(window.location.search);
  const routerParams = new URLSearchParams(location.search);

  let shop = urlParams.get('shop') || routerParams.get('shop');
  let host = urlParams.get('host') || routerParams.get('host');

  // If not in URL, try sessionStorage first
  if (!shop) {
    shop = sessionStorage.getItem('shopify_shop');
  }

  // If still not found, try localStorage as fallback
  if (!shop) {
    shop = localStorage.getItem('shopify_shop');
  }

  // Ensure shop domain has .myshopify.com suffix
  if (shop && !shop.includes('.myshopify.com')) {
    shop = `${shop}.myshopify.com`;
  }

  // Get host from sessionStorage or localStorage if not in URL
  if (!host) {
    host = sessionStorage.getItem('shopify_host');
  }
  if (!host) {
    host = localStorage.getItem('shopify_host');
  }

  // Store shop and host in both sessionStorage and localStorage for persistence
  useEffect(() => {
    if (shop) {
      sessionStorage.setItem('shopify_shop', shop);
      localStorage.setItem('shopify_shop', shop);
      console.log(`✅ Shop domain stored: ${shop}`);
    }
    if (host) {
      sessionStorage.setItem('shopify_host', host);
      localStorage.setItem('shopify_host', host);
    }
  }, [shop, host]);

  // Detect if we're in embedded mode and apply compact styles
  useEffect(() => {
    const isEmbedded = shop || window.self !== window.top; // Has shop param or in iframe

    if (isEmbedded) {
      document.body.classList.add('embedded-app');
      console.log('📱 Running in embedded mode');
    } else {
      document.body.classList.remove('embedded-app');
      console.log('🖥️  Running in standalone mode');
    }
  }, [shop]);

  // Just render children - no Provider wrapper needed in App Bridge v4
  return <>{children}</>;
}
