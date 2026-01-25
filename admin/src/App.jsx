import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppProvider } from '@shopify/polaris';
import AppBridgeProvider from './components/AppBridgeProvider';
import Layout from './components/Layout';

// Pages
import Orders from './pages/Orders';
import OrderDetails from './pages/OrderDetails';
import Products from './pages/Products';
import EmailTemplates from './pages/EmailTemplates';
import Settings from './pages/Settings';

function App() {
  return (
    <AppProvider
      i18n={{
        Polaris: {
          ResourceList: {
            sortingLabel: 'Sort by',
            defaultItemSingular: 'item',
            defaultItemPlural: 'items',
            showing: 'Showing {itemsCount} {resource}',
          },
          Common: {
            checkbox: 'checkbox',
          },
        },
      }}
    >
      <Router>
        <AppBridgeProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<Orders />} />
              <Route path="/orders/:orderId" element={<OrderDetails />} />
              <Route path="/products" element={<Products />} />
              <Route path="/email" element={<EmailTemplates />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Layout>
        </AppBridgeProvider>
      </Router>
    </AppProvider>
  );
}

export default App;
