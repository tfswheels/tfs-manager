import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Page,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Spinner,
  Badge,
  Select,
  TextField,
  Checkbox,
  Divider,
  Box
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function OrderDetails() {
  const { orderId } = useParams();
  const navigate = useNavigate();

  // Order data
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedLineItems, setSelectedLineItems] = useState([]);

  // Vehicle info
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleTrim, setVehicleTrim] = useState('');

  // SDW processing
  const [selectedCard, setSelectedCard] = useState('1');
  const [processingMode, setProcessingMode] = useState('manual');
  const [quoteLink, setQuoteLink] = useState('');
  const [processingSDW, setProcessingSDW] = useState(false);
  const [sdwJobId, setSdwJobId] = useState(null);
  const [sdwJobStatus, setSdwJobStatus] = useState(null);
  const [sdwProgress, setSdwProgress] = useState([]);
  const [calculatedTotal, setCalculatedTotal] = useState(null);
  const [calculatedShipping, setCalculatedShipping] = useState(null);
  const [sdwOrderItems, setSdwOrderItems] = useState([]);
  const [sdwOrderSummary, setSdwOrderSummary] = useState(null);
  const [sdwCompletionData, setSdwCompletionData] = useState(null);
  const [sdwFailureData, setSdwFailureData] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // Interactive Prompts
  const [userInputPrompt, setUserInputPrompt] = useState(null);
  const [userInputResponse, setUserInputResponse] = useState({});
  const [selectedVehicleValue, setSelectedVehicleValue] = useState('');

  // Fetch order details
  useEffect(() => {
    fetchOrderDetails();
  }, [orderId]);

  // Debug: Log when sdwJobStatus changes
  useEffect(() => {
    console.log('🔔 sdwJobStatus changed to:', sdwJobStatus);
  }, [sdwJobStatus]);

  const fetchOrderDetails = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/orders/${orderId}/details`, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      if (response.data.success) {
        setOrder(response.data.order);
        // Pre-select NO items - user must explicitly select
        setSelectedLineItems([]);

        // Pre-fill vehicle info if available
        const orderData = response.data.order;
        setVehicleYear(orderData.vehicle_year || '');
        setVehicleMake(orderData.vehicle_make || '');
        setVehicleModel(orderData.vehicle_model || '');
        setVehicleTrim(orderData.vehicle_trim || '');
      }
    } catch (error) {
      console.error('Error fetching order details:', error);
    } finally {
      setLoading(false);
    }
  };

  // Poll for SDW job status
  const pollSDWJobStatus = async (jobId) => {
    try {
      const response = await axios.get(`${API_URL}/api/orders/sdw-job/${jobId}`, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });
      const status = response.data;

      console.log(`[Poll] Status: ${status.status}, Progress count: ${status.progress?.length || 0}`);
      setSdwJobStatus(status.status);
      setSdwProgress(status.progress || []);

      // Check for interactive prompt (keep processingSDW true so cancel button stays)
      if (status.status === 'awaiting_user_input' && status.userInputPrompt) {
        console.log('🔔 User input required:', status.userInputPrompt.type);
        setUserInputPrompt(status.userInputPrompt);
        // Keep processingSDW true so cancel button remains visible
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

      // If awaiting confirmation, update pricing (keep processingSDW true so cancel button stays)
      if (status.status === 'awaiting_confirmation') {
        console.log(`[Poll] Awaiting confirmation! Total: $${status.totalPrice}, Shipping: $${status.shippingCost}`);
        console.log('[Poll] Order Summary:', status.orderSummary);
        console.log('[Poll] Order Items:', status.orderItems);
        setCalculatedTotal(status.totalPrice);
        setCalculatedShipping(status.shippingCost);
        console.log('[Poll] State updated - should show confirmation UI now');
        // Keep processingSDW true so cancel button remains visible
        return; // Stop polling until user confirms
      }

      // If completed, show success UI
      if (status.status === 'completed') {
        setSdwCompletionData(status.completionData);
        setProcessingSDW(false);
        setIsConfirming(false);
        return; // Stop polling
      }

      // If failed, show failure UI
      if (status.status === 'failed') {
        setSdwFailureData(status.failureData || { error_message: status.error });
        setProcessingSDW(false);
        setIsConfirming(false);
        return; // Stop polling
      }

      // If cancelled, stop
      if (status.status === 'cancelled') {
        setProcessingSDW(false);
        setIsConfirming(false);
        return;
      }

      // Continue polling if still processing (poll every 1 second)
      if (status.status === 'processing' || status.status === 'pending') {
        // Reset confirming state if we're back to processing (after confirmation)
        setIsConfirming(false);
        setTimeout(() => pollSDWJobStatus(jobId), 1000);
      }

    } catch (err) {
      console.error('Error polling job status:', err);
      setProcessingSDW(false);
    }
  };

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
      setIsConfirming(false);
      setSdwProgress([]);
      setSdwJobStatus(null);
      setCalculatedTotal(null);
      setCalculatedShipping(null);
      setSdwCompletionData(null);
      setSdwFailureData(null);

      const response = await axios.post(`${API_URL}/api/orders/process-sdw/start`, {
        orderNumber: order.name,
        shopifyOrderId: order.id,
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
      setIsConfirming(true);
      setSdwProgress(prev => [...prev, { message: 'User confirmed. Completing purchase...', timestamp: new Date() }]);

      const response = await axios.post(`${API_URL}/api/orders/sdw-job/${sdwJobId}/confirm`, {}, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      if (response.data.success) {
        // Resume polling to track completion
        setTimeout(() => pollSDWJobStatus(sdwJobId), 1000);
      }

    } catch (err) {
      console.error('Error confirming purchase:', err);
      alert(err.response?.data?.message || 'Failed to confirm purchase');
      setIsConfirming(false);
      setProcessingSDW(false);
    }
  };

  const handleSubmitUserInput = async (response) => {
    if (!sdwJobId) return;

    try {
      console.log('📤 Submitting user input:', response);

      const apiResponse = await axios.post(
        `${API_URL}/api/orders/sdw-job/${sdwJobId}/user-input`,
        { response },
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      if (apiResponse.data.success) {
        console.log('✅ User input submitted successfully');

        // Clear the prompt
        setUserInputPrompt(null);
        setUserInputResponse({});
        setSelectedVehicleValue('');

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
      '1': 'xxxx-xxxx-xxxx-3438',
      '2': 'xxxx-xxxx-xxxx-3364',
      '3': 'xxxx-xxxx-xxxx-5989',
      '4': 'xxxx-xxxx-xxxx-7260',
      '5': 'WISE'
    };
    return cards[cardId] || 'Unknown';
  };

  const handleCancelProcessing = async () => {
    console.log('🚫 Cancel Processing clicked. JobId:', sdwJobId);

    if (!sdwJobId) {
      console.error('❌ Cannot cancel: No job ID');
      alert('Cannot cancel: No active processing job');
      return;
    }

    try {
      console.log('📡 Sending cancel request...');
      const response = await axios.post(`${API_URL}/api/orders/sdw-job/${sdwJobId}/cancel`, null, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      console.log('✅ Cancel response:', response.data);
      setSdwJobStatus('cancelled');
      setProcessingSDW(false);
      setIsConfirming(false);
    } catch (error) {
      console.error('❌ Error cancelling processing:', error);
      alert(`Failed to cancel: ${error.response?.data?.message || error.message}`);
    }
  };

  if (loading) {
    return (
      <Page
        title="Order Details"
        backAction={{ content: 'Orders', onAction: () => navigate('/') }}
      >
        <Card>
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <Spinner size="large" />
          </div>
        </Card>
      </Page>
    );
  }

  if (!order) {
    return (
      <Page
        title="Order Not Found"
        backAction={{ content: 'Orders', onAction: () => navigate('/') }}
      >
        <Banner tone="critical">
          <p>Order not found</p>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title={`Order ${order.name}`}
      backAction={{ content: 'Orders', onAction: () => navigate('/') }}
      subtitle={`${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`}
    >
      <BlockStack gap="500">
        {/* Order Info Card */}
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Order Information</Text>
              <InlineStack gap="600" wrap={false}>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Order Number</Text>
                    <Text variant="headingSm" fontWeight="bold">{order.name}</Text>
                  </BlockStack>
                </Box>
                <Box minWidth="150px">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Created</Text>
                    <Text variant="bodyMd">{new Date(order.created_at).toLocaleDateString()}</Text>
                  </BlockStack>
                </Box>
                <Box minWidth="120px">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Total</Text>
                    <Text variant="headingSm" fontWeight="bold">${order.total_price}</Text>
                  </BlockStack>
                </Box>
              </InlineStack>
            </BlockStack>
          </Box>
        </Card>

        {/* Customer Info Card */}
        <Card>
          <Box padding="400">
            <BlockStack gap="500">
              <Text variant="headingMd" as="h2">Customer Information</Text>

              {/* Shipping Address */}
              {order.shipping_address && (
                <BlockStack gap="300">
                  <Text variant="headingSm" fontWeight="medium">Shipping Address</Text>
                  <Box
                    background="bg-surface-secondary"
                    padding="300"
                    borderRadius="200"
                  >
                    <BlockStack gap="100">
                      <Text variant="bodyMd">
                        {order.shipping_address.first_name} {order.shipping_address.last_name}
                      </Text>
                      {order.shipping_address.company && (
                        <Text variant="bodyMd">{order.shipping_address.company}</Text>
                      )}
                      <Text variant="bodyMd">{order.shipping_address.address1}</Text>
                      {order.shipping_address.address2 && (
                        <Text variant="bodyMd">{order.shipping_address.address2}</Text>
                      )}
                      <Text variant="bodyMd">
                        {order.shipping_address.city}, {order.shipping_address.province_code} {order.shipping_address.zip}
                      </Text>
                      <Text variant="bodyMd">{order.shipping_address.country}</Text>
                      {order.shipping_address.phone && (
                        <Text variant="bodyMd">Phone: {order.shipping_address.phone}</Text>
                      )}
                    </BlockStack>
                  </Box>
                </BlockStack>
              )}

              <Divider />

              {/* Vehicle Info */}
              <BlockStack gap="300">
                <Text variant="headingSm" fontWeight="medium">Vehicle Information</Text>
                <InlineStack gap="300" wrap={true}>
                  <Box minWidth="150px">
                    <TextField
                      label="Year"
                      value={vehicleYear}
                      onChange={setVehicleYear}
                      autoComplete="off"
                    />
                  </Box>
                  <Box minWidth="200px">
                    <TextField
                      label="Make"
                      value={vehicleMake}
                      onChange={setVehicleMake}
                      autoComplete="off"
                    />
                  </Box>
                  <Box minWidth="200px">
                    <TextField
                      label="Model"
                      value={vehicleModel}
                      onChange={setVehicleModel}
                      autoComplete="off"
                    />
                  </Box>
                  <Box minWidth="200px">
                    <TextField
                      label="Trim"
                      value={vehicleTrim}
                      onChange={setVehicleTrim}
                      autoComplete="off"
                    />
                  </Box>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Box>
        </Card>

        {/* Line Items Card */}
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Line Items</Text>
              <BlockStack gap="300">
                {order.line_items && order.line_items.map((item, index) => {
                  // Check if item should be skipped
                  const itemName = item.name.toLowerCase();
                  const itemSku = (item.sku || '').toUpperCase();

                  const isSkipItem =
                    // Check name for keywords
                    ['shipping protection', 'installation kit', 'hub centric', 'tpms sensors']
                      .some(keyword => itemName.includes(keyword)) ||
                    // Check SKU for MOUNT&BALANCE
                    itemSku === 'MOUNT&BALANCE' ||
                    // Check if product has 'accessories' tag (matches Python script logic)
                    (item.tags && Array.isArray(item.tags) && item.tags.some(tag => tag.toLowerCase() === 'accessories'));

                  // Check if item is removed/cancelled (fulfillable_quantity = 0 or less than quantity)
                  const isRemoved = item.fulfillable_quantity === 0 ||
                                   (item.fulfillable_quantity && item.fulfillable_quantity < item.quantity);

                  const isSelected = selectedLineItems.includes(item.id);
                  const isDisabled = isSkipItem || isRemoved;

                  return (
                    <div key={item.id}>
                      {index > 0 && <Divider />}
                      <Box
                        paddingBlock="300"
                        style={{
                          opacity: isRemoved ? 0.6 : (isSkipItem ? 0.7 : 1),
                          background: isRemoved ? '#f5f5f5' : (isSkipItem ? '#f9f9f9' : 'transparent')
                        }}
                      >
                        <InlineStack gap="400" blockAlign="center">
                          <Checkbox
                            label=""
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
                          <BlockStack gap="200">
                            <Text
                              variant="bodyLg"
                              fontWeight="semibold"
                              tone={isRemoved ? 'subdued' : undefined}
                            >
                              {item.name}
                            </Text>
                            <InlineStack gap="300">
                              <Text variant="bodySm" tone="subdued">SKU: {item.sku}</Text>
                              <Text variant="bodySm" tone="subdued">•</Text>
                              <Text variant="bodySm" tone="subdued">Qty: {item.quantity}</Text>
                              {isRemoved && item.fulfillable_quantity !== undefined && (
                                <>
                                  <Text variant="bodySm" tone="subdued">•</Text>
                                  <Text variant="bodySm" tone="subdued">Fulfillable: {item.fulfillable_quantity}</Text>
                                </>
                              )}
                              {isSkipItem && (
                                <>
                                  <Text variant="bodySm" tone="subdued">•</Text>
                                  <Text variant="bodySm" tone="critical">Auto-skipped</Text>
                                </>
                              )}
                            </InlineStack>
                          </BlockStack>
                        </InlineStack>
                      </Box>
                    </div>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Box>
        </Card>

        {/* SDW Processing Card */}
        <Card>
          <Box padding="400">
            <BlockStack gap="500">
              <Text variant="headingMd" as="h2">Process on SDW</Text>

              {/* Payment Card */}
              <Box maxWidth="300px">
                <Select
                  label="Credit Card"
                  options={[
                    { label: 'xxxx-xxxx-xxxx-3438', value: '1' },
                    { label: 'xxxx-xxxx-xxxx-3364', value: '2' },
                    { label: 'xxxx-xxxx-xxxx-5989', value: '3' },
                    { label: 'xxxx-xxxx-xxxx-7260', value: '4' },
                    { label: 'WISE', value: '5' },
                  ]}
                  value={selectedCard}
                  onChange={setSelectedCard}
                />
              </Box>

              {/* Processing Mode */}
              <BlockStack gap="300">
                <Checkbox
                  label="Use custom quote link"
                  checked={processingMode === 'quote'}
                  onChange={(checked) => setProcessingMode(checked ? 'quote' : 'manual')}
                />
                {processingMode === 'quote' && (
                  <TextField
                    label="Quote Link"
                    value={quoteLink}
                    onChange={setQuoteLink}
                    placeholder="https://www.sdwheelwholesale.com/quote/..."
                    autoComplete="off"
                  />
                )}
              </BlockStack>

              <Divider />

              {/* Action Buttons */}
              <InlineStack gap="300">
                {processingSDW ? (
                  <Button
                    tone="critical"
                    onClick={handleCancelProcessing}
                    size="large"
                  >
                    Cancel Processing
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={handleProcessSDW}
                    disabled={selectedLineItems.length === 0}
                    size="large"
                  >
                    Process Order
                  </Button>
                )}
              </InlineStack>

              {/* Processing Spinner - Only show when actively processing */}
              {processingSDW && sdwJobStatus !== 'awaiting_confirmation' && sdwJobStatus !== 'awaiting_user_input' && (
                <Box paddingBlock="400">
                  <BlockStack gap="300" align="center">
                    <Spinner size="large" />
                    <Text variant="bodyMd" tone="subdued" alignment="center">Processing order on SDW...</Text>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Box>
        </Card>

        {/* Confirmation UI */}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <Text variant="bodyMd">Tax:</Text>
                      <Text variant="bodyMd">{sdwOrderSummary.tax || '$0.00'}</Text>
                    </div>
                    <Box borderBlockStartWidth="025" borderColor="border" paddingBlockStart="200" marginBlockStart="200">
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text variant="bodyLg" fontWeight="bold">Total:</Text>
                        <Text variant="bodyLg" fontWeight="bold">{sdwOrderSummary.total || '$0.00'}</Text>
                      </div>
                    </Box>
                  </div>
                </div>
              )}

              <Banner tone="warning">
                <p><strong>Important:</strong> Clicking "Confirm Purchase" will complete the order on SDW using the selected payment method.</p>
              </Banner>

              <InlineStack gap="300" align="end">
                <Button onClick={handleCancelProcessing}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleConfirmPurchase} loading={isConfirming}>
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

              {userInputPrompt.type === 'vehicle_form_needed' && (
                <div style={{ padding: '16px', background: '#e3f2fd', borderRadius: '8px' }}>
                  <BlockStack gap="300">
                    <Text variant="headingSm" fontWeight="semibold">Vehicle Information Required</Text>

                    <Text variant="bodyMd">
                      Please fill vehicle information for: <strong>{userInputPrompt.data.item?.name}</strong>
                    </Text>

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

              {userInputPrompt.type === 'spacer_selection' && (
                <div style={{ padding: '16px', background: '#fff3e0', borderRadius: '8px' }}>
                  <BlockStack gap="300">
                    <Text variant="headingSm" fontWeight="semibold">
                      🔧 Spacer Recommendation
                    </Text>

                    {userInputPrompt.data.item && (
                      <Text variant="bodyMd">
                        For: <strong>{userInputPrompt.data.item.name}</strong>
                      </Text>
                    )}

                    <Text variant="bodyMd" tone="subdued">
                      This wheel may require spacers. Please select an option:
                    </Text>

                    {userInputPrompt.data.available_options && (
                      <Select
                        label="Choose spacer option"
                        options={[
                          { label: 'Select spacer option...', value: '' },
                          ...userInputPrompt.data.available_options.map(option => {
                            let label = option.text;
                            // Add price info to label if available
                            if (option.price && option.quantity) {
                              const totalPrice = (parseFloat(option.price) * parseInt(option.quantity)).toFixed(2);
                              label = `${option.text} - $${totalPrice}`;
                            }
                            return {
                              label: label,
                              value: option.value
                            };
                          })
                        ]}
                        value={selectedVehicleValue}
                        onChange={(value) => {
                          if (!value) return; // Don't submit empty selection
                          setSelectedVehicleValue(value);
                          const selectedOption = userInputPrompt.data.available_options.find(
                            opt => opt.value === value
                          );
                          handleSubmitUserInput({
                            selected_value: value,
                            selected_text: selectedOption ? selectedOption.text : value
                          });
                          setSelectedVehicleValue('');
                        }}
                      />
                    )}

                    <Button
                      tone="critical"
                      onClick={() => handleSubmitUserInput({ action: 'cancel' })}
                    >
                      Cancel Order Processing
                    </Button>
                  </BlockStack>
                </div>
              )}

              {userInputPrompt.type && userInputPrompt.type.includes('vehicle_') && userInputPrompt.type.includes('_selection') && (
                <div style={{ padding: '16px', background: '#e3f2fd', borderRadius: '8px' }}>
                  <BlockStack gap="300">
                    <Text variant="headingSm" fontWeight="semibold">
                      Select {userInputPrompt.type.replace('vehicle_', '').replace('_selection', '').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </Text>

                    {userInputPrompt.data.item && (
                      <Text variant="bodyMd" tone="subdued">
                        For: <strong>{userInputPrompt.data.item.name}</strong>
                      </Text>
                    )}

                    {userInputPrompt.data.current_selections && Object.keys(userInputPrompt.data.current_selections).length > 0 && (
                      <div style={{ padding: '12px', background: '#f6f6f7', borderRadius: '4px' }}>
                        <Text variant="bodySm" fontWeight="semibold">Current selections:</Text>
                        <div style={{ marginTop: '4px' }}>
                          {Object.entries(userInputPrompt.data.current_selections).map(([key, value]) => (
                            <Text key={key} variant="bodySm">
                              {key.charAt(0).toUpperCase() + key.slice(1)}: {value}
                            </Text>
                          ))}
                        </div>
                      </div>
                    )}

                    {userInputPrompt.data.available_options && (
                      <Select
                        label="Choose from available options"
                        options={[
                          { label: 'Select...', value: '' },
                          ...userInputPrompt.data.available_options.map(option => ({
                            label: option.text || option,
                            value: option.value || option
                          }))
                        ]}
                        value={selectedVehicleValue}
                        onChange={(value) => {
                          setSelectedVehicleValue(value);
                          const selectedOption = userInputPrompt.data.available_options.find(
                            opt => (opt.value || opt) === value
                          );
                          handleSubmitUserInput({
                            selected_value: value,
                            selected_text: selectedOption ? (selectedOption.text || selectedOption) : value
                          });
                          setSelectedVehicleValue('');
                        }}
                      />
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
                    <Text variant="bodyMd">{sdwFailureData.error_message || 'Process exited with code 1'}</Text>
                  </div>

                  {sdwFailureData.current_url && (
                    <div style={{ marginTop: '8px' }}>
                      <Text variant="bodySm" tone="subdued">Last URL: {sdwFailureData.current_url}</Text>
                    </div>
                  )}
                </BlockStack>
              </div>
            </BlockStack>
          </Card>
        )}

        {/* Cancelled State */}
        {sdwJobStatus === 'cancelled' && (
          <Card>
            <Banner tone="info">
              <p><strong>Processing Cancelled</strong></p>
            </Banner>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}

export default OrderDetails;
