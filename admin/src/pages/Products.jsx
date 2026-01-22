import React, { useState } from 'react';
import {
  Page,
  Tabs
} from '@shopify/polaris';
import ManualScrapingTab from '../components/ManualScrapingTab';
import ScheduledScrapingTab from '../components/ScheduledScrapingTab';
import ProductCreationTab from '../components/ProductCreationTab';

export default function Products() {
  const [selectedTab, setSelectedTab] = useState(0);

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

  return (
    <Page
      title="Products & Inventory"
      subtitle="Automated scraping and product creation management"
    >
      <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
        {selectedTab === 0 && <ManualScrapingTab />}
        {selectedTab === 1 && <ScheduledScrapingTab />}
        {selectedTab === 2 && <ProductCreationTab />}
      </Tabs>
    </Page>
  );
}
