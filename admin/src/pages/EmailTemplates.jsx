import React from 'react';
import { Page, Card, Text, EmptyState } from '@shopify/polaris';

export default function EmailTemplates() {
  return (
    <Page title="Email Templates">
      <Card>
        <EmptyState
          heading="Email Template Management"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>Create and manage email templates for customer communication.</p>
        </EmptyState>
      </Card>
    </Page>
  );
}
