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

  // Order Details Modal
  const [orderDetailsModalOpen, setOrderDetailsModalOpen] = useState(false);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [selectedLineItems, setSelectedLineItems] = useState([]);

  // Vehicle info editing
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleTrim, setVehicleTrim] = useState('');

  // SDW Configuration
  const [selectedCard, setSelectedCard] = useState('1');
  const [processingMode, setProcessingMode] = useState('manual');
  const [quoteLink, setQuoteLink] = useState('');
  const [processingSDW, setProcessingSDW] = useState(false);

  // SDW Job Tracking
  const [sdwJobId, setSdwJobId] = useState(null);
  const [sdwJobStatus, setSdwJobStatus] = useState(null);
  const [sdwProgress, setSdwProgress] = useState([]);
  const [calculatedTotal, setCalculatedTotal] = useState(null);
  const [calculatedShipping, setCalculatedShipping] = useState(null);
  const [sdwOrderItems, setSdwOrderItems] = useState([]);
  const [sdwOrderSummary, setSdwOrderSummary] = useState(null);
  const [sdwCompletionData, setSdwCompletionData] = useState(null);
  const [sdwFailureData, setSdwFailureData] = useState(null);

  // Interactive Prompts
  const [userInputPrompt, setUserInputPrompt] = useState(null);
  const [userInputModalOpen, setUserInputModalOpen] = useState(false);
  const [userInputResponse, setUserInputResponse] = useState({});

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

  const handleRowClick = async (order) => {
    try {
      setLoadingOrderDetails(true);
      setOrderDetailsModalOpen(true);

      // Reset SDW state for new order
      setSdwJobId(null);
      setSdwJobStatus(null);
      setSdwProgress([]);
      setProcessingSDW(false);
      setCalculatedTotal(null);
      setCalculatedShipping(null);
      setSdwOrderItems([]);
      setSdwOrderSummary(null);
      setSdwCompletionData(null);
      setSdwFailureData(null);
      setProcessingMode('manual');
      setQuoteLink('');
      setUserInputPrompt(null);
      setUserInputModalOpen(false);
      setUserInputResponse({});

      const response = await axios.get(`${API_URL}/api/orders/${order.shopify_order_id}/details`, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      const orderData = response.data.order;
      setSelectedOrderDetails(orderData);

      // Pre-fill vehicle info
      setVehicleYear(order.vehicle_year || '');
      setVehicleMake(order.vehicle_make || '');
      setVehicleModel(order.vehicle_model || '');
      setVehicleTrim(order.vehicle_trim || '');

      // Start with NO items selected - user must explicitly select items to process
      setSelectedLineItems([]);

    } catch (err) {
      console.error('Error fetching order details:', err);
      alert('Failed to load order details');
      setOrderDetailsModalOpen(false);
    } finally {
      setLoadingOrderDetails(false);
    }
  };

  // Poll for SDW job status
  const pollSDWJobStatus = useCallback(async (jobId) => {
    try {
      const response = await axios.get(`${API_URL}/api/orders/sdw-job/${jobId}`);
      const status = response.data;

      console.log(`[Poll] Status: ${status.status}, Progress count: ${status.progress?.length || 0}`);
      setSdwJobStatus(status.status);
      setSdwProgress(status.progress || []);

      // Check for interactive prompt
      if (status.status === 'awaiting_user_input' && status.userInputPrompt) {
        console.log('🔔 User input required:', status.userInputPrompt.type);
        setUserInputPrompt(status.userInputPrompt);
        setUserInputModalOpen(true);
        // Don't continue polling while waiting for input
        return;
      }

      // Update order items and summary if available
      if (status.orderItems) {
        setSdwOrderItems(status.orderItems);
      }
      if (status.orderSummary) {
        setSdwOrderSummary(status.orderSummary);
      }

      // If awaiting confirmation, update pricing (UI shows inline confirmation)
      if (status.status === 'awaiting_confirmation') {
        console.log(`[Poll] Awaiting confirmation! Total: $${status.totalPrice}, Shipping: $${status.shippingCost}`);
        setCalculatedTotal(status.totalPrice);
        setCalculatedShipping(status.shippingCost);
        setProcessingSDW(false); // Stop spinner, show confirmation UI
        return; // Stop polling until user confirms
      }

      // If completed, show success UI
      if (status.status === 'completed') {
        setSdwCompletionData(status.completionData);
        setProcessingSDW(false);
        return; // Stop polling
      }

      // If failed, show failure UI
      if (status.status === 'failed') {
        setSdwFailureData(status.failureData || { error_message: status.error });
        setProcessingSDW(false);
        return; // Stop polling
      }

      // Continue polling if still processing (poll every 1 second)
      if (status.status === 'processing' || status.status === 'pending') {
        setTimeout(() => pollSDWJobStatus(jobId), 1000);
      }

    } catch (err) {
      console.error('Error polling job status:', err);
      setProcessingSDW(false);
    }
  }, []);

  const handleProcessSDW = async () => {
    if (processingSDW) return;

    // Validation
    if (selectedLineItems.length === 0) {
      alert('Please select at least one item to process');
      return;
    }

    if (processingMode === 'quote' && !quoteLink.trim()) {
      alert('Please enter a quote link');
      return;
    }

    // Build vehicle string
    const vehicleParts = [vehicleYear, vehicleMake, vehicleModel, vehicleTrim].filter(Boolean);
    const vehicleString = vehicleParts.join(' ');

    const confirmed = confirm(
      `Process ${selectedLineItems.length} item(s) on SDW?\n\n` +
      `Vehicle: ${vehicleString || 'Not provided'}\n` +
      `Card: ${getCardName(selectedCard)}\n` +
      `Mode: ${processingMode === 'quote' ? 'Custom Quote' : 'Manual Search'}`
    );

    if (!confirmed) return;

    try {
      setProcessingSDW(true);

      const response = await axios.post(`${API_URL}/api/orders/process-sdw/start`, {
        orderNumber: selectedOrderDetails.name,
        shopifyOrderId: selectedOrderDetails.id,
        selectedLineItems,
        vehicle: {
          year: vehicleYear,
          make: vehicleMake,
          model: vehicleModel,
          trim: vehicleTrim
        },
        card: selectedCard,
        mode: processingMode,
        quoteLink: quoteLink
      }, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      if (response.data.success && response.data.jobId) {
        setSdwJobId(response.data.jobId);
        // Start polling immediately for status
        pollSDWJobStatus(response.data.jobId);
      }

    } catch (err) {
      console.error('Error processing SDW order:', err);
      alert(err.response?.data?.message || 'Failed to start SDW processing');
      setProcessingSDW(false);
    }
  };

  const handleConfirmPurchase = async () => {
    if (!sdwJobId) return;

    try {
      setProcessingSDW(true);
      setSdwProgress(prev => [...prev, { message: 'User confirmed. Completing purchase...', timestamp: new Date() }]);

      const response = await axios.post(`${API_URL}/api/orders/sdw-job/${sdwJobId}/confirm`);

      if (response.data.success) {
        // Resume polling to track completion
        setTimeout(() => pollSDWJobStatus(sdwJobId), 1000);
      }

    } catch (err) {
      console.error('Error confirming purchase:', err);
      alert(err.response?.data?.message || 'Failed to confirm purchase');
      setProcessingSDW(false);
    }
  };

  const handleSubmitUserInput = async (response) => {
    if (!sdwJobId) return;

    try {
      console.log('📤 Submitting user input:', response);

      const apiResponse = await axios.post(
        `${API_URL}/api/orders/sdw-job/${sdwJobId}/user-input`,
        { response }
      );

      if (apiResponse.data.success) {
        console.log('✅ User input submitted successfully');

        // Close the modal
        setUserInputModalOpen(false);
        setUserInputPrompt(null);
        setUserInputResponse({});

        // Add progress message
        setSdwProgress(prev => [...prev, {
          message: 'User input received. Resuming processing...',
          timestamp: new Date()
        }]);

        // Resume polling
        setTimeout(() => pollSDWJobStatus(sdwJobId), 500);
      }

    } catch (err) {
      console.error('Error submitting user input:', err);
      alert(err.response?.data?.message || 'Failed to submit response');
    }
  };

  const getCardName = (cardId) => {
    const cards = {
      '1': 'Card ending 3438',
      '2': 'Card ending 3364',
      '3': 'Card ending 5989',
      '4': 'Card ending 7260',
      '5': 'WISE'
    };
    return cards[cardId] || 'Unknown';
  };

  const handleSyncOrders = async () => {
    if (syncing) return;

    try {
      setSyncing(true);
      const response = await axios.post(`${API_URL}/api/orders/sync`, null, {
        params: {
          shop: '2f3d7a-2.myshopify.com',
          limit: 2000
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

      {/* Order Details Modal with SDW Processing */}
      <Modal
        open={orderDetailsModalOpen}
        onClose={() => setOrderDetailsModalOpen(false)}
        title={selectedOrderDetails ? `Order ${selectedOrderDetails.name}` : 'Order Details'}
        primaryAction={{
          content: 'Process on SDW',
          onAction: handleProcessSDW,
          loading: processingSDW,
          disabled: selectedLineItems.length === 0 || processingSDW
        }}
        secondaryActions={[
          {
            content: 'Close',
            onAction: () => setOrderDetailsModalOpen(false)
          }
        ]}
        large
      >
        <Modal.Section>
          {loadingOrderDetails ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <Spinner size="large" />
            </div>
          ) : selectedOrderDetails ? (
            <BlockStack gap="500">
              {/* Order Information */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h3">Order Information</Text>
                  <InlineStack gap="400" wrap>
                    <Text as="span"><strong>Customer:</strong> {selectedOrderDetails.customer?.first_name} {selectedOrderDetails.customer?.last_name}</Text>
                    <Text as="span"><strong>Email:</strong> {selectedOrderDetails.email || '-'}</Text>
                    <Text as="span"><strong>Total:</strong> {formatCurrency(selectedOrderDetails.total_price)}</Text>
                  </InlineStack>
                  <div>
                    <Text variant="bodyMd" as="p" fontWeight="semibold">Shipping Address:</Text>
                    <Text as="p">
                      {selectedOrderDetails.shipping_address?.address1}<br />
                      {selectedOrderDetails.shipping_address?.city}, {selectedOrderDetails.shipping_address?.province} {selectedOrderDetails.shipping_address?.zip}
                    </Text>
                  </div>
                </BlockStack>
              </Card>

              {/* Vehicle Information */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h3">Vehicle Information</Text>
                  <InlineStack gap="300" wrap>
                    <div style={{ flex: 1, minWidth: '150px' }}>
                      <TextField
                        label="Year"
                        value={vehicleYear}
                        onChange={setVehicleYear}
                        placeholder="2017"
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: '150px' }}>
                      <TextField
                        label="Make"
                        value={vehicleMake}
                        onChange={setVehicleMake}
                        placeholder="Lincoln"
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: '150px' }}>
                      <TextField
                        label="Model"
                        value={vehicleModel}
                        onChange={setVehicleModel}
                        placeholder="Continental"
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ flex: 2, minWidth: '200px' }}>
                      <TextField
                        label="Trim"
                        value={vehicleTrim}
                        onChange={setVehicleTrim}
                        placeholder="Select FWD 4 Dr Sedan"
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Line Items */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h3">Order Items</Text>
                  <Text variant="bodyMd" tone="subdued">Select items to process on SDW</Text>

                  {selectedOrderDetails.line_items?.map((item) => {
                    const isSkipItem = ['shipping protection', 'installation kit', 'hub centric']
                      .some(keyword => item.name.toLowerCase().includes(keyword));

                    // Check if item is removed/cancelled (fulfillable_quantity = 0 or less than quantity)
                    const isRemoved = item.fulfillable_quantity === 0 ||
                                     (item.fulfillable_quantity && item.fulfillable_quantity < item.quantity);

                    const isSelected = selectedLineItems.includes(item.id);
                    const isDisabled = isSkipItem || isRemoved;

                    return (
                      <div
                        key={item.id}
                        style={{
                          padding: '12px',
                          background: isRemoved ? '#f5f5f5' : (isSkipItem ? '#f9f9f9' : (isSelected ? '#f0f7ff' : '#ffffff')),
                          border: isSelected ? '2px solid #0066cc' : '1px solid #e1e1e1',
                          borderRadius: '8px',
                          opacity: isRemoved ? 0.6 : 1
                        }}
                      >
                        <InlineStack gap="300" align="start">
                          <Checkbox
                            checked={isSelected}
                            onChange={(checked) => {
                              if (checked) {
                                setSelectedLineItems([...selectedLineItems, item.id]);
                              } else {
                                setSelectedLineItems(selectedLineItems.filter(id => id !== item.id));
                              }
                            }}
                            disabled={isDisabled}
                          />
                          <BlockStack gap="100">
                            <Text variant="bodyMd" as="p" fontWeight="semibold" tone={isRemoved ? 'subdued' : undefined}>
                              {item.name}
                            </Text>
                            <InlineStack gap="300">
                              <Text variant="bodySm" tone="subdued">SKU: {item.sku || '-'}</Text>
                              <Text variant="bodySm" tone="subdued">Qty: {item.quantity}</Text>
                              {isRemoved && item.fulfillable_quantity !== undefined && (
                                <Text variant="bodySm" tone="subdued">Fulfillable: {item.fulfillable_quantity}</Text>
                              )}
                              <Text variant="bodySm" fontWeight="medium" tone={isRemoved ? 'subdued' : undefined}>
                                {formatCurrency(item.price)}
                              </Text>
                            </InlineStack>
                            <InlineStack gap="200">
                              {isSkipItem && (
                                <Badge tone="info">Auto-skipped</Badge>
                              )}
                              {isRemoved && (
                                <Badge tone="critical">Removed/Cancelled</Badge>
                              )}
                            </InlineStack>
                          </BlockStack>
                        </InlineStack>
                      </div>
                    );
                  })}
                </BlockStack>
              </Card>

              {/* SDW Configuration */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h3">SDW Configuration</Text>

                  <Select
                    label="Credit Card"
                    options={[
                      { label: 'Card ending 3438', value: '1' },
                      { label: 'Card ending 3364', value: '2' },
                      { label: 'Card ending 5989', value: '3' },
                      { label: 'Card ending 7260', value: '4' },
                      { label: 'WISE', value: '5' }
                    ]}
                    value={selectedCard}
                    onChange={setSelectedCard}
                  />

                  <div>
                    <Text variant="bodyMd" as="p" fontWeight="semibold">Processing Mode</Text>
                    <div style={{ marginTop: '8px' }}>
                      <BlockStack gap="200">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            checked={processingMode === 'manual'}
                            onChange={() => setProcessingMode('manual')}
                          />
                          <Text>Manual Search (Search and add items)</Text>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            checked={processingMode === 'quote'}
                            onChange={() => setProcessingMode('quote')}
                          />
                          <Text>Custom Quote (I have a quote link)</Text>
                        </label>
                      </BlockStack>
                    </div>
                  </div>

                  {processingMode === 'quote' && (
                    <TextField
                      label="Quote Link"
                      value={quoteLink}
                      onChange={setQuoteLink}
                      placeholder="https://www.sdwheelwholesale.com/quote/..."
                      autoComplete="off"
                      requiredIndicator
                    />
                  )}

                  <Banner tone="info">
                    <p>
                      <strong>Note:</strong> SDW processing will run with the selected configuration.
                      You'll be asked to confirm before the final purchase is completed.
                    </p>
                  </Banner>
                </BlockStack>
              </Card>

              {/* SDW Progress Display */}
              {sdwProgress.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Processing Progress</Text>
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {sdwProgress.map((prog, idx) => (
                        <div key={idx} style={{ padding: '8px 0', borderBottom: idx < sdwProgress.length - 1 ? '1px solid #e1e1e1' : 'none' }}>
                          <Text variant="bodySm">{prog.message}</Text>
                        </div>
                      ))}
                    </div>
                    {processingSDW && sdwJobStatus !== 'awaiting_confirmation' && sdwJobStatus !== 'awaiting_user_input' && (
                      <div style={{ textAlign: 'center', padding: '12px 0' }}>
                        <Spinner size="small" />
                      </div>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* Inline Purchase Confirmation */}
              {sdwJobStatus === 'awaiting_confirmation' && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h3">Confirm Purchase</Text>

                    <Banner tone="success">
                      <p><strong>Shipping calculated successfully!</strong></p>
                    </Banner>

                    {/* Order Items */}
                    {sdwOrderItems.length > 0 && (
                      <div style={{ padding: '16px', background: '#f6f6f7', borderRadius: '8px' }}>
                        <Text variant="headingSm" as="h4" fontWeight="semibold">Items to Process:</Text>
                        <div style={{ marginTop: '12px' }}>
                          {sdwOrderItems.map((item, idx) => (
                            <div key={idx} style={{ padding: '8px 0', borderBottom: idx < sdwOrderItems.length - 1 ? '1px solid #e1e1e1' : 'none' }}>
                              <Text variant="bodyMd" fontWeight="medium">{item.name}</Text>
                              <div style={{ marginTop: '4px' }}>
                                <Text variant="bodySm" tone="subdued">
                                  SKU: {item.sku || 'N/A'} | Qty: {item.quantity} | Type: {item.product_type}
                                </Text>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Order Summary */}
                    {sdwOrderSummary && (
                      <div style={{ padding: '16px', background: '#f6f6f7', borderRadius: '8px' }}>
                        <Text variant="headingSm" as="h4" fontWeight="semibold">Order Summary:</Text>
                        <div style={{ marginTop: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <Text variant="bodyMd">Subtotal:</Text>
                            <Text variant="bodyMd">{sdwOrderSummary.subtotal || '$0.00'}</Text>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <Text variant="bodyMd">Shipping:</Text>
                            <Text variant="bodyMd">{sdwOrderSummary.shipping || '$0.00'}</Text>
                          </div>
                          {sdwOrderSummary.shipping_protection && sdwOrderSummary.shipping_protection !== '$0.00' && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <Text variant="bodyMd">Shipping Protection:</Text>
                              <Text variant="bodyMd">{sdwOrderSummary.shipping_protection}</Text>
                            </div>
                          )}
                          {sdwOrderSummary.mounting_balancing && sdwOrderSummary.mounting_balancing !== '$0.00' && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <Text variant="bodyMd">Mounting & Balancing:</Text>
                              <Text variant="bodyMd">{sdwOrderSummary.mounting_balancing}</Text>
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <Text variant="bodyMd">Tax:</Text>
                            <Text variant="bodyMd">{sdwOrderSummary.tax || '$0.00'}</Text>
                          </div>
                          <Divider />
                          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px' }}>
                            <Text variant="bodyLg" fontWeight="bold">Total:</Text>
                            <Text variant="bodyLg" fontWeight="bold">{sdwOrderSummary.total || '$0.00'}</Text>
                          </div>
                        </div>
                      </div>
                    )}

                    <Banner tone="warning">
                      <p><strong>Important:</strong> Clicking "Confirm Purchase" will complete the order on SDW using the selected payment method.</p>
                    </Banner>

                    <InlineStack gap="300" align="end">
                      <Button onClick={() => {
                        setProcessingSDW(false);
                        setOrderDetailsModalOpen(false);
                      }}>
                        Cancel
                      </Button>
                      <Button primary onClick={handleConfirmPurchase} loading={processingSDW}>
                        Confirm Purchase
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}

              {/* Interactive User Input Prompt */}
              {sdwJobStatus === 'awaiting_user_input' && userInputPrompt && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h3">Action Required</Text>

                    <Banner tone="warning">
                      <p><strong>User input needed to continue processing</strong></p>
                    </Banner>

                    {userInputPrompt.type === 'vehicle_form_failed' && (
                      <div style={{ padding: '16px', background: '#fff4e6', borderRadius: '8px' }}>
                        <BlockStack gap="300">
                          <Text variant="headingSm" fontWeight="semibold">Vehicle Form Failed</Text>

                          <Text variant="bodyMd">
                            The vehicle information could not be filled automatically for: <strong>{userInputPrompt.data.item?.name}</strong>
                          </Text>

                          {userInputPrompt.data.vehicle_info && (
                            <div style={{ padding: '12px', background: '#f6f6f7', borderRadius: '4px' }}>
                              <Text variant="bodySm" tone="subdued">
                                Current vehicle: {userInputPrompt.data.vehicle_info.year} {userInputPrompt.data.vehicle_info.make} {userInputPrompt.data.vehicle_info.model} {userInputPrompt.data.vehicle_info.trim}
                              </Text>
                            </div>
                          )}

                          {userInputPrompt.data.available_models && userInputPrompt.data.available_models.length > 0 && (
                            <div style={{ padding: '12px', background: '#f6f6f7', borderRadius: '4px' }}>
                              <Text variant="bodySm" fontWeight="semibold">Available models:</Text>
                              <div style={{ marginTop: '8px', maxHeight: '100px', overflowY: 'auto' }}>
                                <Text variant="bodySm" tone="subdued">
                                  {userInputPrompt.data.available_models.slice(0, 10).join(', ')}
                                  {userInputPrompt.data.available_models.length > 10 && '...'}
                                </Text>
                              </div>
                            </div>
                          )}

                          <Text variant="bodyMd" fontWeight="semibold">What would you like to do?</Text>

                          <BlockStack gap="200">
                            <Button
                              primary
                              onClick={() => handleSubmitUserInput({ action: 'interactive_form' })}
                            >
                              Interactive Vehicle Info Form
                            </Button>

                            <Button
                              tone="critical"
                              onClick={() => handleSubmitUserInput({ action: 'cancel' })}
                            >
                              Cancel Order Processing
                            </Button>
                          </BlockStack>
                        </BlockStack>
                      </div>
                    )}

                    {(userInputPrompt.type === 'vehicle_year_selection' ||
                      userInputPrompt.type === 'vehicle_make_selection' ||
                      userInputPrompt.type === 'vehicle_model_selection' ||
                      userInputPrompt.type === 'vehicle_trim_selection') && (
                      <div style={{ padding: '16px', background: '#e3f2fd', borderRadius: '8px' }}>
                        <BlockStack gap="300">
                          <Text variant="headingSm" fontWeight="semibold">
                            {userInputPrompt.type === 'vehicle_year_selection' && 'Select Vehicle Year'}
                            {userInputPrompt.type === 'vehicle_make_selection' && 'Select Vehicle Make'}
                            {userInputPrompt.type === 'vehicle_model_selection' && 'Select Vehicle Model'}
                            {userInputPrompt.type === 'vehicle_trim_selection' && 'Select Vehicle Trim'}
                          </Text>

                          {userInputPrompt.data.item && (
                            <Text variant="bodyMd" tone="subdued">
                              For: <strong>{userInputPrompt.data.item.name}</strong>
                            </Text>
                          )}

                          {userInputPrompt.data.current_selections && (
                            <div style={{ padding: '12px', background: '#f6f6f7', borderRadius: '4px' }}>
                              <Text variant="bodySm" fontWeight="semibold">Current selections:</Text>
                              <div style={{ marginTop: '4px' }}>
                                {userInputPrompt.data.current_selections.year && (
                                  <Text variant="bodySm">Year: {userInputPrompt.data.current_selections.year}</Text>
                                )}
                                {userInputPrompt.data.current_selections.make && (
                                  <Text variant="bodySm">Make: {userInputPrompt.data.current_selections.make}</Text>
                                )}
                                {userInputPrompt.data.current_selections.model && (
                                  <Text variant="bodySm">Model: {userInputPrompt.data.current_selections.model}</Text>
                                )}
                              </div>
                            </div>
                          )}

                          {userInputPrompt.data.available_options && (
                            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                              <BlockStack gap="200">
                                {userInputPrompt.data.available_options.map((option, idx) => (
                                  <Button
                                    key={idx}
                                    onClick={() => handleSubmitUserInput({
                                      selected_value: option.value || option,
                                      selected_text: option.text || option
                                    })}
                                    fullWidth
                                    textAlign="start"
                                  >
                                    {option.text || option}
                                  </Button>
                                ))}
                              </BlockStack>
                            </div>
                          )}

                          <Button
                            tone="critical"
                            onClick={() => handleSubmitUserInput({ action: 'cancel' })}
                          >
                            Cancel
                          </Button>
                        </BlockStack>
                      </div>
                    )}

                    {userInputPrompt.type === 'manual_add_confirmation' && (
                      <div style={{ padding: '16px', background: '#e3f2fd', borderRadius: '8px' }}>
                        <BlockStack gap="300">
                          <Text variant="bodyMd">{userInputPrompt.data.message}</Text>

                          <InlineStack gap="300">
                            <Button
                              primary
                              onClick={() => handleSubmitUserInput({ confirmed: true })}
                            >
                              Done - Item Added to Cart
                            </Button>

                            <Button
                              onClick={() => handleSubmitUserInput({ confirmed: false })}
                            >
                              Cancel
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </div>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* Success State */}
              {sdwJobStatus === 'completed' && sdwCompletionData && (
                <Card>
                  <BlockStack gap="400">
                    <Banner tone="success">
                      <p><strong>Order Processing Complete!</strong></p>
                    </Banner>

                    <div style={{ padding: '16px', background: '#e8f5e9', borderRadius: '8px' }}>
                      <BlockStack gap="300">
                        <Text variant="headingMd" as="h3" fontWeight="bold">SDW Order Details:</Text>

                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Text variant="bodyMd" fontWeight="semibold">Shopify Order:</Text>
                          <Text variant="bodyMd">#{sdwCompletionData.order_number}</Text>
                        </div>

                        {sdwCompletionData.invoice_number && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Text variant="bodyMd" fontWeight="semibold">SDW Invoice:</Text>
                            <Text variant="bodyMd" fontWeight="bold">{sdwCompletionData.invoice_number}</Text>
                          </div>
                        )}

                        {sdwCompletionData.invoice_total && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Text variant="bodyMd" fontWeight="semibold">Total:</Text>
                            <Text variant="bodyMd">${sdwCompletionData.invoice_total}</Text>
                          </div>
                        )}

                        {sdwCompletionData.folder_name && (
                          <div style={{ marginTop: '8px' }}>
                            <Text variant="bodySm" tone="subdued">Folder: {sdwCompletionData.folder_name}</Text>
                          </div>
                        )}
                      </BlockStack>
                    </div>

                    <InlineStack gap="300" align="end">
                      <Button primary onClick={() => {
                        setOrderDetailsModalOpen(false);
                      }}>
                        Close
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}

              {/* Failure State */}
              {sdwJobStatus === 'failed' && sdwFailureData && (
                <Card>
                  <BlockStack gap="400">
                    <Banner tone="critical">
                      <p><strong>Order Processing Failed</strong></p>
                    </Banner>

                    <div style={{ padding: '16px', background: '#ffebee', borderRadius: '8px' }}>
                      <BlockStack gap="300">
                        <Text variant="headingMd" as="h3" fontWeight="bold">Error Details:</Text>

                        <div>
                          <Text variant="bodyMd" fontWeight="semibold">Error Type:</Text>
                          <Text variant="bodyMd">{sdwFailureData.error_type || 'Unknown'}</Text>
                        </div>

                        <div>
                          <Text variant="bodyMd" fontWeight="semibold">Message:</Text>
                          <Text variant="bodyMd">{sdwFailureData.error_message || 'An error occurred during processing'}</Text>
                        </div>

                        {sdwFailureData.current_url && (
                          <div style={{ marginTop: '8px' }}>
                            <Text variant="bodySm" tone="subdued">Last URL: {sdwFailureData.current_url}</Text>
                          </div>
                        )}
                      </BlockStack>
                    </div>

                    <InlineStack gap="300" align="end">
                      <Button primary onClick={() => {
                        setOrderDetailsModalOpen(false);
                      }}>
                        Close
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          ) : null}
        </Modal.Section>
      </Modal>

    </Page>
  );
}
