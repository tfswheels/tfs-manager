import React from 'react';
import { AppProvider, Page, Card, Layout, Text } from '@shopify/polaris';

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
      <Page title="TFS Manager - Dashboard">
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <Text variant="headingLg" as="h1">
                  Welcome to TFS Manager
                </Text>
                <div style={{ marginTop: '20px' }}>
                  <Text variant="bodyLg" as="p" tone="subdued">
                    Your comprehensive Shopify management system for TFS Wheels
                  </Text>
                </div>
                <div style={{ marginTop: '30px', padding: '20px', background: '#f6f6f7', borderRadius: '8px' }}>
                  <Text variant="headingMd" as="h2">
                    System Status
                  </Text>
                  <div style={{ marginTop: '12px' }}>
                    <Text variant="bodyMd" as="p" tone="success">
                      ✓ Backend API Connected
                    </Text>
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <Text variant="bodyMd" as="p" tone="success">
                      ✓ Database Connected
                    </Text>
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <Text variant="bodyMd" as="p">
                      Ready to manage orders, products, and customer communication
                    </Text>
                  </div>
                </div>
              </div>
            </Card>
          </Layout.Section>

          <Layout.Section secondary>
            <Card>
              <div style={{ padding: '20px' }}>
                <Text variant="headingMd" as="h3">
                  Quick Access
                </Text>
                <div style={{ marginTop: '16px' }}>
                  <div style={{ marginBottom: '12px' }}>
                    <Text variant="bodyMd" as="p">
                      📦 Orders Management
                    </Text>
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <Text variant="bodyMd" as="p">
                      🛍️ Products Catalog
                    </Text>
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <Text variant="bodyMd" as="p">
                      📧 Email Templates
                    </Text>
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <Text variant="bodyMd" as="p">
                      🔧 Inventory Scraping
                    </Text>
                  </div>
                  <div>
                    <Text variant="bodyMd" as="p">
                      ⚙️ Settings
                    </Text>
                  </div>
                </div>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}

export default App;
