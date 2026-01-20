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
  TextField,
  Select,
  Checkbox,
  InlineStack,
  BlockStack,
  Box,
  Divider
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [limit, setLimit] = useState('50');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Bulk selection
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  // Send Email Modal
  const [sendEmailModalOpen, setSendEmailModalOpen] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templates, setTemplates] = useState([]);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchOrders();
    fetchTemplates();
  }, [limit, page]);

  const fetchTemplates = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/email-templates`, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      setTemplates(response.data.templates || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  const fetchOrders = async () => {
    if (loading) return;

    try {
      setLoading(true);
      setError(null);

      const response = await axios.get(`${API_URL}/api/orders`, {
        params: {
          shop: '2f3d7a-2.myshopify.com',
          limit: parseInt(limit),
          page: page,
          search: searchQuery
        }
      });

      setOrders(response.data.orders || []);
      setTotal(response.data.total || 0);
      setHasMore(response.data.hasMore || false);
      setSelectedOrders([]);
      setSelectAll(false);
    } catch (err) {
      console.error('Error fetching orders:', err);
      setError(err.response?.data?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    fetchOrders();
  };

  const handleSearchClear = () => {
    setSearchQuery('');
    setPage(1);
    setTimeout(() => fetchOrders(), 0);
  };

  const handleLimitChange = (value) => {
    setLimit(value);
    setPage(1);
  };

  const handleSelectAll = (checked) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedOrders(orders.map(o => o.id));
    } else {
      setSelectedOrders([]);
    }
  };

  const handleSelectOrder = (orderId, checked) => {
    if (checked) {
      setSelectedOrders([...selectedOrders, orderId]);
    } else {
      setSelectedOrders(selectedOrders.filter(id => id !== orderId));
      setSelectAll(false);
    }
  };

  const openSendEmailModal = (orderIds) => {
    const recipients = orders.filter(o => orderIds.includes(o.id));
    setEmailRecipients(recipients);
    setSelectedTemplate('');
    setSendEmailModalOpen(true);
  };

  const handleSendEmail = async () => {
    if (!selectedTemplate) {
      alert('Please select an email template');
      return;
    }

    if (emailRecipients.length === 0) {
      alert('No recipients selected');
      return;
    }

    try {
      setSendingEmail(true);

      const response = await axios.post(`${API_URL}/api/email/send`, {
        templateId: parseInt(selectedTemplate),
        orderIds: emailRecipients.map(r => r.id)
      }, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      const { sent, failed, errors } = response.data;

      if (failed > 0) {
        const errorMessages = errors.map(e => `${e.orderNumber}: ${e.error}`).join('\n');
        alert(`Sent ${sent} email(s) successfully.\n\nFailed to send ${failed} email(s):\n${errorMessages}`);
      } else {
        alert(`Successfully sent ${sent} email(s)!`);
      }

      setSendEmailModalOpen(false);
    } catch (err) {
      console.error('Error sending emails:', err);
      alert(err.response?.data?.message || 'Failed to send emails');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendEmailToSelected = () => {
    if (selectedOrders.length === 0) {
      alert('Please select at least one order');
      return;
    }
    openSendEmailModal(selectedOrders);
  };

  const handleRowClick = (order) => {
    openSendEmailModal([order.id]);
  };

  const handleSyncOrders = async () => {
    if (syncing) return;

    try {
      setSyncing(true);
      const response = await axios.post(`${API_URL}/api/orders/sync`, null, {
        params: {
          shop: '2f3d7a-2.myshopify.com',
          limit: 250
        }
      });

      if (response.data.success) {
        alert(`Successfully synced ${response.data.synced} orders from Shopify`);
        fetchOrders();
      }
    } catch (err) {
      console.error('Error syncing orders:', err);
      alert(err.response?.data?.message || 'Failed to sync orders');
    } finally {
      setSyncing(false);
    }
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
      year: 'numeric'
    });
  };

  const formatVehicleInfo = (order) => {
    const parts = [
      order.vehicle_year,
      order.vehicle_make,
      order.vehicle_model,
      order.vehicle_trim
    ].filter(Boolean);

    if (parts.length === 0) {
      return (
        <Badge tone="attention">No vehicle info</Badge>
      );
    }

    return (
      <Text as="span" variant="bodyMd">
        {parts.join(' ')}
      </Text>
    );
  };

  const formatTags = (tags) => {
    if (!tags) return <Text tone="subdued">No tags</Text>;

    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length === 0) return <Text tone="subdued">No tags</Text>;

    return (
      <InlineStack gap="100" wrap={false}>
        {tagList.slice(0, 2).map((tag, idx) => (
          <Badge key={idx}>{tag}</Badge>
        ))}
        {tagList.length > 2 && (
          <Text as="span" tone="subdued" variant="bodySm">+{tagList.length - 2}</Text>
        )}
      </InlineStack>
    );
  };

  const rows = orders.map((order) => {
    const isSelected = selectedOrders.includes(order.id);

    return [
      <Checkbox
        checked={isSelected}
        onChange={(checked) => handleSelectOrder(order.id, checked)}
      />,
      <Button plain onClick={() => handleRowClick(order)}>
        {order.order_number}
      </Button>,
      formatDate(order.created_at),
      <Text as="span" variant="bodyMd" fontWeight="medium">{order.customer_name || 'Guest'}</Text>,
      <Text as="span" variant="bodySm" tone="subdued">{order.customer_email || '-'}</Text>,
      formatVehicleInfo(order),
      formatTags(order.tags),
      <Text as="span" variant="bodyMd" fontWeight="semibold">{formatCurrency(order.total_price)}</Text>
    ];
  });

  const headings = [
    <Checkbox
      checked={selectAll}
      onChange={handleSelectAll}
    />,
    'Order #',
    'Date',
    'Customer',
    'Email',
    'Vehicle Info',
    'Tags',
    'Total'
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
            <Button onClick={() => fetchOrders()}>Retry</Button>
          </div>
        </Banner>
      </Page>
    );
  }

  if (orders.length === 0 && !loading && !searchQuery) {
    return (
      <Page title="Orders">
        <EmptyState
          heading="No orders found"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>When you receive orders, they will appear here.</p>
          <div style={{ marginTop: '16px' }}>
            <Button onClick={() => fetchOrders()}>Refresh</Button>
          </div>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page
      title="Orders"
      subtitle={`${total} total order${total !== 1 ? 's' : ''}`}
      primaryAction={{
        content: 'Refresh',
        onAction: () => fetchOrders()
      }}
      secondaryActions={[
        {
          content: 'Sync from Shopify',
          onAction: handleSyncOrders,
          loading: syncing
        },
        ...(selectedOrders.length > 0
          ? [
              {
                content: `Send Email to Selected (${selectedOrders.length})`,
                onAction: handleSendEmailToSelected
              }
            ]
          : [])
      ]}
    >
      <BlockStack gap="400">
        {/* Search and Pagination Controls */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="400" align="space-between" blockAlign="center">
              <div style={{ flex: 1, maxWidth: '500px' }}>
                <TextField
                  placeholder="Search by order #, customer name, or email..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                  clearButton
                  onClearButtonClick={handleSearchClear}
                  autoComplete="off"
                  connectedRight={
                    <Button onClick={handleSearch} loading={loading}>
                      Search
                    </Button>
                  }
                />
              </div>
              <InlineStack gap="200" align="end">
                <Text variant="bodyMd" as="span">
                  Show:
                </Text>
                <div style={{ minWidth: '100px' }}>
                  <Select
                    options={[
                      { label: '50', value: '50' },
                      { label: '100', value: '100' },
                      { label: '150', value: '150' },
                      { label: '200', value: '200' },
                      { label: '250', value: '250' },
                      { label: '500', value: '500' }
                    ]}
                    value={limit}
                    onChange={handleLimitChange}
                  />
                </div>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Orders Table */}
        <Card>
          {orders.length === 0 && searchQuery ? (
            <Box padding="800">
              <EmptyState
                heading="No orders found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Try adjusting your search query</p>
                <div style={{ marginTop: '16px' }}>
                  <Button onClick={handleSearchClear}>Clear Search</Button>
                </div>
              </EmptyState>
            </Box>
          ) : (
            <>
              <DataTable
                columnContentTypes={[
                  'text', // Checkbox
                  'text', // Order #
                  'text', // Date
                  'text', // Customer
                  'text', // Email
                  'text', // Vehicle Info
                  'text', // Tags
                  'numeric' // Total
                ]}
                headings={headings}
                rows={rows}
                hoverable
              />

              <Divider />

              {/* Pagination */}
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Showing {orders.length} of {total} order{total !== 1 ? 's' : ''}
                    {searchQuery && ` matching "${searchQuery}"`}
                  </Text>
                  <InlineStack gap="200">
                    <Button
                      onClick={() => setPage(page - 1)}
                      disabled={page === 1 || loading}
                    >
                      Previous
                    </Button>
                    <Text variant="bodyMd" as="span">
                      Page {page}
                    </Text>
                    <Button
                      onClick={() => setPage(page + 1)}
                      disabled={!hasMore || loading}
                    >
                      Next
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Box>
            </>
          )}
        </Card>
      </BlockStack>

      {/* Send Email Modal */}
      <Modal
        open={sendEmailModalOpen}
        onClose={() => setSendEmailModalOpen(false)}
        title="Send Email"
        primaryAction={{
          content: 'Send Email',
          onAction: handleSendEmail,
          loading: sendingEmail,
          disabled: !selectedTemplate || sendingEmail
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setSendEmailModalOpen(false)
          }
        ]}
        large
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h3">
              Recipients ({emailRecipients.length})
            </Text>
            <BlockStack gap="200">
              {emailRecipients.map((order) => (
                <div key={order.id} style={{ padding: '8px', background: '#f6f6f7', borderRadius: '8px' }}>
                  <Text variant="bodyMd" as="p">
                    <strong>{order.order_number}</strong> - {order.customer_name} ({order.customer_email})
                  </Text>
                  {formatVehicleInfo(order) !== '-' && (
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Vehicle: {formatVehicleInfo(order)}
                    </Text>
                  )}
                </div>
              ))}
            </BlockStack>

            <Divider />

            <Select
              label="Email Template"
              options={[
                { label: 'Select a template...', value: '' },
                ...templates.map(t => ({
                  label: `${t.name} (${t.category || 'general'})`,
                  value: t.id.toString()
                }))
              ]}
              value={selectedTemplate}
              onChange={setSelectedTemplate}
              requiredIndicator
            />

            {selectedTemplate && (
              <>
                {(() => {
                  const template = templates.find(t => t.id.toString() === selectedTemplate);
                  if (!template) return null;

                  return (
                    <div style={{ padding: '16px', background: '#f6f6f7', borderRadius: '8px' }}>
                      <Text variant="headingMd" as="h3">Template Preview</Text>
                      <div style={{ marginTop: '12px' }}>
                        <Text variant="bodyMd" as="p" fontWeight="semibold">Subject:</Text>
                        <Text variant="bodyMd" as="p">{template.subject}</Text>
                      </div>
                      <div style={{ marginTop: '12px' }}>
                        <Text variant="bodyMd" as="p" fontWeight="semibold">Body:</Text>
                        <div style={{ marginTop: '8px', whiteSpace: 'pre-wrap', fontSize: '13px' }}>
                          {template.body}
                        </div>
                      </div>
                      {template.description && (
                        <div style={{ marginTop: '12px' }}>
                          <Text variant="bodyMd" as="p" tone="subdued">
                            <em>{template.description}</em>
                          </Text>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}

            {templates.length === 0 && (
              <Banner tone="warning">
                <p>No email templates found. Create an email template first in the Email Templates page.</p>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
