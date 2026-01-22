import React, { useState } from 'react';
import {
  Page,
  Tabs
} from '@shopify/polaris';
import ScheduledScrapingTab from '../components/ScheduledScrapingTab';
import ProductCreationTab from '../components/ProductCreationTab';

export default function Products() {
  const [selectedTab, setSelectedTab] = useState(0);

  const tabs = [
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
        {selectedTab === 0 && <ScheduledScrapingTab />}
        {selectedTab === 1 && <ProductCreationTab />}
      </Tabs>
    </Page>
  );
}
