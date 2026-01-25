import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AppProvider, Frame, TopBar, Text } from '@shopify/polaris';

// Pages
import Orders from './pages/Orders';
import OrderDetails from './pages/OrderDetails';
import Products from './pages/Products';
import EmailTemplates from './pages/EmailTemplates';
import Settings from './pages/Settings';

function AppContent() {
  const location = useLocation();

  // Determine which tab is active based on current route
  const getActiveTab = () => {
    if (location.pathname.startsWith('/products')) return 'products';
    if (location.pathname.startsWith('/email')) return 'email';
    if (location.pathname.startsWith('/settings')) return 'settings';
    return 'orders';
  };

  const activeTab = getActiveTab();

  // Navigation tabs with proper React Router Links
  const navTabs = (
    <div style={{ display: 'flex', gap: '24px', alignItems: 'center', paddingTop: '8px' }}>
      <Link to="/" style={{ textDecoration: 'none' }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: activeTab === 'orders' ? '2px solid #2c6ecb' : '2px solid transparent',
          color: activeTab === 'orders' ? '#2c6ecb' : '#202223',
          fontWeight: activeTab === 'orders' ? '600' : '400'
        }}>
          Orders
        </div>
      </Link>
      <Link to="/products" style={{ textDecoration: 'none' }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: activeTab === 'products' ? '2px solid #2c6ecb' : '2px solid transparent',
          color: activeTab === 'products' ? '#2c6ecb' : '#202223',
          fontWeight: activeTab === 'products' ? '600' : '400'
        }}>
          Products & Inventory
        </div>
      </Link>
      <Link to="/email" style={{ textDecoration: 'none' }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: activeTab === 'email' ? '2px solid #2c6ecb' : '2px solid transparent',
          color: activeTab === 'email' ? '#2c6ecb' : '#202223',
          fontWeight: activeTab === 'email' ? '600' : '400'
        }}>
          Email Templates
        </div>
      </Link>
      <Link to="/settings" style={{ textDecoration: 'none' }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: activeTab === 'settings' ? '2px solid #2c6ecb' : '2px solid transparent',
          color: activeTab === 'settings' ? '#2c6ecb' : '#202223',
          fontWeight: activeTab === 'settings' ? '600' : '400'
        }}>
          Settings
        </div>
      </Link>
    </div>
  );

  const topBarMarkup = (
    <TopBar
      showNavigationToggle={false}
      userMenu={null}
      searchField={null}
    />
  );

  return (
    <Frame topBar={topBarMarkup}>
      <div style={{ padding: '0 20px', backgroundColor: '#f6f6f7', borderBottom: '1px solid #e1e3e5' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingTop: '16px' }}>
          <Text variant="headingXl" as="h1">TFS Manager</Text>
        </div>
        {navTabs}
      </div>
      <div style={{ padding: '0' }}>
        <Routes>
          <Route path="/" element={<Orders />} />
          <Route path="/orders/:orderId" element={<OrderDetails />} />
          <Route path="/products" element={<Products />} />
          <Route path="/email" element={<EmailTemplates />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
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
