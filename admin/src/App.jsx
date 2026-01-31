import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider } from '@shopify/polaris';
import AppBridgeProvider from './components/AppBridgeProvider';
import Layout from './components/Layout';
import StaffRegistration from './components/StaffRegistration';

// Pages
import Orders from './pages/Orders';
import OrderDetails from './pages/OrderDetails';
import Products from './pages/Products';
import EmailThread from './pages/EmailThread';
import EmailTemplates from './pages/EmailTemplates';
import Settings from './pages/Settings';
import SupportTickets from './pages/SupportTickets';
import TicketSettings from './pages/TicketSettings';

// Redirect component for old email routes
function EmailRedirect() {
  const { conversationId } = useParams();
  return <Navigate to={`/tickets/${conversationId}`} replace />;
}

// ============================================================================
// ⚠️ CRITICAL: DO NOT REMOVE THIS COMPONENT
// ============================================================================
// This component has been broken and fixed 3 times. Read CLAUDE.md before
// modifying any routing logic!
//
// PROBLEM:
// This app runs in a Shopify admin iframe. When users refresh the page,
// Shopify strips URL parameters and resets the iframe to "/", causing users
// to lose their place and get sent back to Orders page.
//
// SOLUTION:
// Use localStorage to persist the last visited path. localStorage survives:
// - Shopify iframe refresh
// - URL parameter stripping
// - Parent window navigation
//
// WHY NOT USE URL PARAMS?
// Shopify strips them during iframe refresh - doesn't work.
//
// WHY NOT USE window.history.replaceState ON PARENT?
// Doesn't work in iframe - security restrictions.
//
// TESTING:
// 1. Navigate to /products
// 2. Refresh the page (Cmd+R or F5)
// 3. Should stay on /products, NOT go to Orders
// 4. Check console for 🔵 logs to verify it's working
//
// See CLAUDE.md section "⚠️ CRITICAL: localStorage Routing" for full details.
// ============================================================================
function RouteManager({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Store path in localStorage when route changes
  useEffect(() => {
    if (location.pathname !== '/') {
      console.log('🔵 Storing path in localStorage:', location.pathname);
      localStorage.setItem('tfs_last_path', location.pathname);
    }
  }, [location.pathname]);

  // Restore path from localStorage on mount
  useEffect(() => {
    const storedPath = localStorage.getItem('tfs_last_path');
    console.log('🔵 Checking for stored path:', storedPath);

    if (location.pathname === '/' && storedPath && storedPath !== '/') {
      console.log('🔵 Restoring path from localStorage:', storedPath);
      navigate(storedPath, { replace: true });
    }
  }, []); // Only run on mount

  return children;
}
// ============================================================================
// END OF CRITICAL ROUTING COMPONENT
// ============================================================================

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
          {/* ⚠️ CRITICAL: RouteManager must wrap Layout - see comments above and CLAUDE.md */}
          <RouteManager>
            {/* Staff Registration Modal - shows on first app access */}
            <StaffRegistration>
              <Layout>
                <Routes>
                  <Route path="/" element={<Orders />} />
                  <Route path="/orders/:orderId" element={<OrderDetails />} />
                  <Route path="/products" element={<Products />} />
                  <Route path="/tickets" element={<SupportTickets />} />
                  <Route path="/tickets/settings" element={<TicketSettings />} />
                  <Route path="/tickets/:conversationId" element={<EmailThread />} />
                  {/* Redirect old /emails routes to /tickets */}
                  <Route path="/emails" element={<Navigate to="/tickets" replace />} />
                  <Route path="/emails/:conversationId" element={<EmailRedirect />} />
                  <Route path="/email" element={<EmailTemplates />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Layout>
            </StaffRegistration>
          </RouteManager>
        </AppBridgeProvider>
      </Router>
    </AppProvider>
  );
}

export default App;
