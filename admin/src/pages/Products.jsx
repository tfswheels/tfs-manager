import React from 'react';
import { Page, Card, Text, EmptyState } from '@shopify/polaris';

export default function Products() {
  return (
    <Page title="Products">
      <Card>
        <EmptyState
          heading="Product Management"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>Product catalog and inventory management coming soon.</p>
        </EmptyState>
      </Card>
    </Page>
  );
}
