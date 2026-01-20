import React from 'react';
import { Page, Card, Text, EmptyState } from '@shopify/polaris';

export default function Scraping() {
  return (
    <Page title="Inventory Scraping">
      <Card>
        <EmptyState
          heading="Inventory Scraping & Automation"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>Schedule and manage inventory scraping jobs for wheels and tires.</p>
        </EmptyState>
      </Card>
    </Page>
  );
}
