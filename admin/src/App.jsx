import React, { useState, useCallback } from 'react';
import { AppProvider, Frame, Navigation, TopBar, Page, Card, Layout, Text } from '@shopify/polaris';
import { HomeMajor, OrdersMajor, ProductsMajor, EmailMajor, SettingsMajor } from '@shopify/polaris-icons';

function App() {
  const [mobileNavigationActive, setMobileNavigationActive] = useState(false);

  const toggleMobileNavigationActive = useCallback(
    () => setMobileNavigationActive((mobileNavigationActive) => !mobileNavigationActive),
    [],
  );

  const logo = {
    width: 124,
    topBarSource: '/tfs-logo.svg',
    contextualSaveBarSource: '/tfs-logo.svg',
    url: '/',
    accessibilityLabel: 'TFS Manager',
  };

  const userMenuMarkup = (
    <TopBar.UserMenu
      actions={[
        {
          items: [{ content: 'Shopify Admin', url: 'https://admin.shopify.com/store/2f3d7a-2' }],
        },
      ]}
      name="TFS Wheels"
      initials="TW"
    />
  );

  const topBarMarkup = (
    <TopBar
      showNavigationToggle
      userMenu={userMenuMarkup}
      onNavigationToggle={toggleMobileNavigationActive}
    />
  );

  const navigationMarkup = (
    <Navigation location="/">
      <Navigation.Section
        items={[
          {
            url: '/',
            label: 'Dashboard',
            icon: HomeMajor,
            selected: true,
          },
          {
            url: '/orders',
            label: 'Orders',
            icon: OrdersMajor,
          },
          {
            url: '/products',
            label: 'Products',
            icon: ProductsMajor,
          },
          {
            url: '/email',
            label: 'Email Templates',
            icon: EmailMajor,
          },
          {
            url: '/settings',
            label: 'Settings',
            icon: SettingsMajor,
          },
        ]}
      />
    </Navigation>
  );

  return (
    <AppProvider
      i18n={{
        Polaris: {
          ResourceList: {
            sortingLabel: 'Sort by',
            defaultItemSingular: 'item',
            defaultItemPlural: 'items',
            showing: 'Showing {itemsCount} {resource}',
            Item: {
              viewItem: 'View details for {itemName}',
            },
          },
          Common: {
            checkbox: 'checkbox',
          },
        },
      }}
    >
      <Frame
        logo={logo}
        topBar={topBarMarkup}
        navigation={navigationMarkup}
        showMobileNavigation={mobileNavigationActive}
        onNavigationDismiss={toggleMobileNavigationActive}
      >
        <Page title="Dashboard">
          <Layout>
            <Layout.Section>
              <Card>
                <div style={{ padding: '20px' }}>
                  <Text variant="headingLg" as="h2">
                    Welcome to TFS Manager
                  </Text>
                  <div style={{ marginTop: '16px' }}>
                    <Text variant="bodyMd" as="p">
                      Your comprehensive Shopify management system for TFS Wheels.
                    </Text>
                  </div>
                </div>
              </Card>
            </Layout.Section>

            <Layout.Section secondary>
              <Card>
                <div style={{ padding: '20px' }}>
                  <Text variant="headingMd" as="h3">
                    Quick Stats
                  </Text>
                  <div style={{ marginTop: '16px' }}>
                    <Text variant="bodyMd" as="p">
                      Loading...
                    </Text>
                  </div>
                </div>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      </Frame>
    </AppProvider>
  );
}

export default App;
