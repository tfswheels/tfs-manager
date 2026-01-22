import React, { useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, Frame, Navigation } from '@shopify/polaris';

// Pages
import Orders from './pages/Orders';
import OrderDetails from './pages/OrderDetails';
import Products from './pages/Products';
import EmailTemplates from './pages/EmailTemplates';
import Settings from './pages/Settings';

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();

  const navigationMarkup = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        items={[
          {
            label: 'Orders',
            icon: () => '📦',
            onClick: () => navigate('/'),
            selected: location.pathname === '/'
          },
          {
            label: 'Products & Inventory',
            icon: () => '🛍️',
            onClick: () => navigate('/products'),
            selected: location.pathname === '/products'
          },
          {
            label: 'Email Templates',
            icon: () => '📧',
            onClick: () => navigate('/email'),
            selected: location.pathname === '/email'
          },
          {
            label: 'Settings',
            icon: () => '⚙️',
            onClick: () => navigate('/settings'),
            selected: location.pathname === '/settings'
          }
        ]}
      />
    </Navigation>
  );

  return (
    <Frame navigation={navigationMarkup}>
      <Routes>
        <Route path="/" element={<Orders />} />
        <Route path="/orders/:orderId" element={<OrderDetails />} />
        <Route path="/products" element={<Products />} />
        <Route path="/email" element={<EmailTemplates />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Frame>
  );
}

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
        <AppContent />
      </Router>
    </AppProvider>
  );
}

export default App;
