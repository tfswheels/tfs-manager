import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Page,
  Tabs
} from '@shopify/polaris';
import ManualScrapingTab from '../components/ManualScrapingTab';
import ScheduledScrapingTab from '../components/ScheduledScrapingTab';
import ProductCreationTab from '../components/ProductCreationTab';

// Define tabs at module level to avoid recreation on every render
const TABS = [
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

// Map tab parameter to index (default to 0 if no param or invalid)
// Define at module level to avoid recreation on every render
const getTabIndex = (param) => {
  if (!param) return 0;
  const index = TABS.findIndex(t => t.id.startsWith(param));
  return index >= 0 ? index : 0;
};

export default function Products() {
  const location = useLocation();
  const navigate = useNavigate();

  // Parse tab from URL query parameter
  const searchParams = new URLSearchParams(location.search);
  const tabParam = searchParams.get('tab');

  const [selectedTab, setSelectedTab] = useState(getTabIndex(tabParam));

  // Update selected tab when URL changes (e.g., back/forward navigation)
  useEffect(() => {
    const newTabIndex = getTabIndex(tabParam);
    if (newTabIndex !== selectedTab) {
      setSelectedTab(newTabIndex);
    }
  }, [tabParam, selectedTab]); // Include all dependencies

  // Handle tab selection and update URL
  const handleTabChange = (index) => {
    const tabId = TABS[index].id.split('-')[0]; // Extract 'manual', 'scheduled', or 'product'
    setSelectedTab(index); // Update state first
    navigate(`/products?tab=${tabId}`, { replace: true }); // Then navigate
  };

  return (
    <Page
      title="Products & Inventory"
      subtitle="Automated scraping and product creation management"
    >
      <Tabs tabs={TABS} selected={selectedTab} onSelect={handleTabChange}>
        {selectedTab === 0 && <ManualScrapingTab />}
        {selectedTab === 1 && <ScheduledScrapingTab />}
        {selectedTab === 2 && <ProductCreationTab />}
      </Tabs>
    </Page>
  );
}
