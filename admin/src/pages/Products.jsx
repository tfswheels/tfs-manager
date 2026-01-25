import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Page,
  Tabs
} from '@shopify/polaris';
import ManualScrapingTab from '../components/ManualScrapingTab';
import ScheduledScrapingTab from '../components/ScheduledScrapingTab';
import ProductCreationTab from '../components/ProductCreationTab';

export default function Products() {
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = [
    {
      id: 'manual-scraping',
      content: 'Manual Scraping',
      panelID: 'manual-scraping-panel'
    },
    {
      id: 'scheduled-scraping',
      content: 'Scheduled Scraping',
      panelID: 'scheduled-scraping-panel'
    },
    {
      id: 'product-creation',
      content: 'Product Creation',
      panelID: 'product-creation-panel'
    }
  ];

  // Parse tab from URL query parameter
  const searchParams = new URLSearchParams(location.search);
  const tabParam = searchParams.get('tab');

  // Map tab parameter to index (default to 0 if no param or invalid)
  const getTabIndex = (param) => {
    if (!param) return 0;
    const index = tabs.findIndex(t => t.id.startsWith(param));
    return index >= 0 ? index : 0;
  };

  const [selectedTab, setSelectedTab] = useState(getTabIndex(tabParam));

  // Update selected tab when URL changes (e.g., back/forward navigation)
  useEffect(() => {
    const newTabIndex = getTabIndex(tabParam);
    if (newTabIndex !== selectedTab) {
      setSelectedTab(newTabIndex);
    }
  }, [tabParam]);

  // Handle tab selection and update URL
  const handleTabChange = (index) => {
    const tabId = tabs[index].id.split('-')[0]; // Extract 'manual', 'scheduled', or 'product'
    navigate(`/products?tab=${tabId}`, { replace: true });
    setSelectedTab(index);
  };

  return (
    <Page
      title="Products & Inventory"
      subtitle="Automated scraping and product creation management"
    >
      <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
        {selectedTab === 0 && <ManualScrapingTab />}
        {selectedTab === 1 && <ScheduledScrapingTab />}
        {selectedTab === 2 && <ProductCreationTab />}
      </Tabs>
    </Page>
  );
}
