import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Card,
  DataTable,
  Badge,
  Text,
  Banner,
  Spinner,
  EmptyState,
  Button,
  Modal,
  Layout,
  ResourceList,
  ResourceItem,
  Thumbnail
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';
const BATCH_SIZE = 50;

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderDetailsOpen, setOrderDetailsOpen] = useState(false);
  const [processingOrder, setProcessingOrder] = useState(false);

  useEffect(() => {
    fetchOrders(1);
  }, []);

  const fetchOrders = async (pageNum) => {
    if (loading) return;

    try {
      setLoading(true);
      setError(null);

      const response = await axios.get(`${API_URL}/api/orders`, {
        params: {
          shop: '2f3d7a-2.myshopify.com',
          limit: BATCH_SIZE,
          page: pageNum
        }
      });

      const newOrders = response.data.orders || [];

      if (pageNum === 1) {
        setOrders(newOrders);
      } else {
        setOrders(prev => [...prev, ...newOrders]);
      }

      setHasMore(newOrders.length === BATCH_SIZE);
      setPage(pageNum);
    } catch (err) {
      console.error('Error fetching orders:', err);
      setError(err.response?.data?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      fetchOrders(page + 1);
    }
  };

  const handleOrderClick = (order) => {
    setSelectedOrder(order);
    setOrderDetailsOpen(true);
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
    <Button plain onClick={() => handleOrderClick(order)}>{order.order_number || order.name}</Button>,
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

  if (loading && orders.length === 0) {
    return (
      <Page title="Orders">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 0' }}>
          <Spinner size="large" />
          <Text variant="bodyMd" as="p" tone="subdued" style={{ marginLeft: '12px' }}>
            Loading orders...
          </Text>
        </div>
      </Page>
    );
  }

  if (error && orders.length === 0) {
    return (
      <Page title="Orders">
        <Banner tone="critical" title="Error loading orders">
          <p>{error}</p>
          <div style={{ marginTop: '16px' }}>
            <Button onClick={() => fetchOrders(1)}>Retry</Button>
          </div>
        </Banner>
      </Page>
    );
  }

  if (orders.length === 0 && !loading) {
    return (
      <Page title="Orders">
        <EmptyState
          heading="No orders found"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>When you receive orders, they will appear here.</p>
          <div style={{ marginTop: '16px' }}>
            <Button onClick={() => fetchOrders(1)}>Refresh</Button>
          </div>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page
      title="Orders"
      subtitle={`${orders.length} order${orders.length !== 1 ? 's' : ''} loaded`}
      primaryAction={{
        content: 'Refresh',
        onAction: () => fetchOrders(1)
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

        {hasMore && (
          <div style={{ padding: '16px', textAlign: 'center', borderTop: '1px solid #e1e3e5' }}>
            <Button
              onClick={loadMore}
              loading={loading}
              disabled={loading}
            >
              {loading ? `Loading more orders...` : `Load More (${orders.length} of many)`}
            </Button>
          </div>
        )}

        {!hasMore && orders.length > 0 && (
          <div style={{ padding: '16px', textAlign: 'center', borderTop: '1px solid #e1e3e5' }}>
            <Text variant="bodyMd" as="p" tone="subdued">
              All orders loaded ({orders.length} total)
            </Text>
          </div>
        )}
      </Card>

      {/* Order Details Modal */}
      <Modal
        open={orderDetailsOpen}
        onClose={() => setOrderDetailsOpen(false)}
        title={`Order ${selectedOrder?.name || ''}`}
        large
        primaryAction={{
          content: 'Close',
          onAction: () => setOrderDetailsOpen(false)
        }}
        secondaryActions={[
          {
            content: 'Process via SDW',
            onAction: () => {
              console.log('Process via SDW:', selectedOrder);
              // TODO: Implement SDW processing
            }
          },
          {
            content: 'Print PDF',
            onAction: () => {
              console.log('Print PDF:', selectedOrder);
              // TODO: Implement PDF generation
            }
          }
        ]}
      >
        {selectedOrder && (
          <Modal.Section>
            <Layout>
              <Layout.Section>
                <Card>
                  <div style={{ padding: '16px' }}>
                    <Text variant="headingMd" as="h3">Customer Information</Text>
                    <div style={{ marginTop: '12px' }}>
                      <Text variant="bodyMd" as="p">
                        <strong>Name:</strong> {selectedOrder.customer?.default_address?.name || selectedOrder.customer?.first_name + ' ' + selectedOrder.customer?.last_name || 'Guest'}
                      </Text>
                      <Text variant="bodyMd" as="p">
                        <strong>Email:</strong> {selectedOrder.customer?.email || 'N/A'}
                      </Text>
                      <Text variant="bodyMd" as="p">
                        <strong>Phone:</strong> {selectedOrder.customer?.phone || 'N/A'}
                      </Text>
                    </div>
                  </div>
                </Card>
              </Layout.Section>

              <Layout.Section>
                <Card>
                  <div style={{ padding: '16px' }}>
                    <Text variant="headingMd" as="h3">Order Details</Text>
                    <div style={{ marginTop: '12px' }}>
                      <Text variant="bodyMd" as="p">
                        <strong>Total:</strong> {formatCurrency(selectedOrder.total_price)}
                      </Text>
                      <Text variant="bodyMd" as="p">
                        <strong>Payment:</strong> {getFinancialStatusBadge(selectedOrder.financial_status)}
                      </Text>
                      <Text variant="bodyMd" as="p">
                        <strong>Fulfillment:</strong> {getFulfillmentStatusBadge(selectedOrder.fulfillment_status)}
                      </Text>
                      <Text variant="bodyMd" as="p">
                        <strong>Date:</strong> {formatDate(selectedOrder.created_at)}
                      </Text>
                    </div>
                  </div>
                </Card>
              </Layout.Section>

              <Layout.Section>
                <Card>
                  <div style={{ padding: '16px' }}>
                    <Text variant="headingMd" as="h3">Line Items ({selectedOrder.line_items?.length || 0})</Text>
                    <div style={{ marginTop: '16px' }}>
                      {selectedOrder.line_items?.map((item, index) => (
                        <div
                          key={index}
                          style={{
                            padding: '12px',
                            borderBottom: index < selectedOrder.line_items.length - 1 ? '1px solid #e1e3e5' : 'none',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <Text variant="bodyMd" as="p" fontWeight="semibold">
                              {item.title}
                            </Text>
                            {item.variant_title && (
                              <Text variant="bodyMd" as="p" tone="subdued">
                                {item.variant_title}
                              </Text>
                            )}
                            <Text variant="bodyMd" as="p" tone="subdued">
                              SKU: {item.sku || 'N/A'}
                            </Text>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <Text variant="bodyMd" as="p">
                              Qty: {item.quantity}
                            </Text>
                            <Text variant="bodyMd" as="p" fontWeight="semibold">
                              {formatCurrency(item.price)}
                            </Text>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              </Layout.Section>
            </Layout>
          </Modal.Section>
        )}
      </Modal>
    </Page>
  );
}
