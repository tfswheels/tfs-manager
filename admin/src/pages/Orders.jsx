import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  DataTable,
  Badge,
  Text,
  Banner,
  Spinner,
  EmptyState,
  Button
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedOrders, setSelectedOrders] = useState([]);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await axios.get(`${API_URL}/api/orders`, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      setOrders(response.data.orders || []);
    } catch (err) {
      console.error('Error fetching orders:', err);
      setError(err.response?.data?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const getFinancialStatusBadge = (status) => {
    const statusMap = {
      paid: 'success',
      pending: 'attention',
      refunded: 'warning',
      voided: 'critical'
    };
    return <Badge tone={statusMap[status] || 'info'}>{status || 'unknown'}</Badge>;
  };

  const getFulfillmentStatusBadge = (status) => {
    if (!status) return <Badge tone="info">unfulfilled</Badge>;

    const statusMap = {
      fulfilled: 'success',
      partial: 'attention',
      unfulfilled: 'info'
    };
    return <Badge tone={statusMap[status] || 'info'}>{status}</Badge>;
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const rows = orders.map((order) => [
    order.order_number || order.name,
    formatDate(order.created_at),
    order.customer?.default_address?.name || order.customer?.email || 'Guest',
    order.customer?.email || '-',
    formatCurrency(order.total_price),
    getFinancialStatusBadge(order.financial_status),
    getFulfillmentStatusBadge(order.fulfillment_status),
    order.line_items?.length || 0
  ]);

  const headings = [
    'Order',
    'Date',
    'Customer',
    'Email',
    'Total',
    'Payment',
    'Fulfillment',
    'Items'
  ];

  if (loading) {
    return (
      <Page title="Orders">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 0' }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Orders">
        <Banner tone="critical" title="Error loading orders">
          <p>{error}</p>
          <div style={{ marginTop: '16px' }}>
            <Button onClick={fetchOrders}>Retry</Button>
          </div>
        </Banner>
      </Page>
    );
  }

  if (orders.length === 0) {
    return (
      <Page title="Orders">
        <EmptyState
          heading="No orders found"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>When you receive orders, they will appear here.</p>
          <div style={{ marginTop: '16px' }}>
            <Button onClick={fetchOrders}>Refresh</Button>
          </div>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page
      title="Orders"
      subtitle={`${orders.length} order${orders.length !== 1 ? 's' : ''}`}
      primaryAction={{
        content: 'Refresh',
        onAction: fetchOrders
      }}
    >
      <Card>
        <DataTable
          columnContentTypes={[
            'text',
            'text',
            'text',
            'text',
            'numeric',
            'text',
            'text',
            'numeric'
          ]}
          headings={headings}
          rows={rows}
          hoverable
        />
      </Card>
    </Page>
  );
}
