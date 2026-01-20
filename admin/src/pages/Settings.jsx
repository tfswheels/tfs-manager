import React from 'react';
import { Page, Card, Text, EmptyState } from '@shopify/polaris';

export default function Settings() {
  return (
    <Page title="Settings">
      <Card>
        <EmptyState
          heading="Application Settings"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>Configure email settings, notifications, and application preferences.</p>
        </EmptyState>
      </Card>
    </Page>
  );
}
