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
  Checkbox
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

  // Interactive Prompts
  const [userInputPrompt, setUserInputPrompt] = useState(null);
  const [userInputResponse, setUserInputResponse] = useState({});
  const [selectedVehicleValue, setSelectedVehicleValue] = useState('');

  // Fetch order details
  useEffect(() => {
    fetchOrderDetails();
  }, [orderId]);

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
        // Pre-select all line items
        const lineItemIds = response.data.order.line_items.map(item => item.id);
        setSelectedLineItems(lineItemIds);
      }
    } catch (error) {
      console.error('Error fetching order details:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelProcessing = async () => {
    if (!sdwJobId) return;

    try {
      await axios.post(`${API_URL}/api/orders/sdw-job/${sdwJobId}/cancel`, null, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      setSdwJobStatus('cancelled');
      setProcessingSDW(false);
    } catch (error) {
      console.error('Error cancelling processing:', error);
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
      title={`Order #${order.order_number}`}
      backAction={{ content: 'Orders', onAction: () => navigate('/') }}
      subtitle={`${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`}
    >
      <BlockStack gap="400">
        {/* Order Info Card */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Order Information</Text>
            <InlineStack gap="400">
              <div>
                <Text variant="bodySm" tone="subdued">Order Number</Text>
                <Text variant="bodyMd" fontWeight="bold">{order.order_number}</Text>
              </div>
              <div>
                <Text variant="bodySm" tone="subdued">Created</Text>
                <Text variant="bodyMd">{new Date(order.created_at).toLocaleDateString()}</Text>
              </div>
              <div>
                <Text variant="bodySm" tone="subdued">Total</Text>
                <Text variant="bodyMd" fontWeight="bold">${order.total_price}</Text>
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Line Items Card */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Line Items</Text>
            {order.line_items && order.line_items.map((item) => (
              <div key={item.id} style={{ padding: '12px', background: '#f6f6f7', borderRadius: '8px' }}>
                <InlineStack align="space-between">
                  <BlockStack gap="100">
                    <Text variant="bodyMd" fontWeight="semibold">{item.name}</Text>
                    <Text variant="bodySm" tone="subdued">SKU: {item.sku} | Qty: {item.quantity}</Text>
                  </BlockStack>
                  <Checkbox
                    label="Process"
                    checked={selectedLineItems.includes(item.id)}
                    onChange={(checked) => {
                      if (checked) {
                        setSelectedLineItems([...selectedLineItems, item.id]);
                      } else {
                        setSelectedLineItems(selectedLineItems.filter(id => id !== item.id));
                      }
                    }}
                  />
                </InlineStack>
              </div>
            ))}
          </BlockStack>
        </Card>

        {/* SDW Processing Card */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Process on SDW</Text>

            {/* Vehicle Info */}
            <BlockStack gap="300">
              <Text variant="bodyMd" fontWeight="semibold">Vehicle Information</Text>
              <InlineStack gap="200">
                <TextField
                  label="Year"
                  value={vehicleYear}
                  onChange={setVehicleYear}
                  autoComplete="off"
                />
                <TextField
                  label="Make"
                  value={vehicleMake}
                  onChange={setVehicleMake}
                  autoComplete="off"
                />
                <TextField
                  label="Model"
                  value={vehicleModel}
                  onChange={setVehicleModel}
                  autoComplete="off"
                />
                <TextField
                  label="Trim"
                  value={vehicleTrim}
                  onChange={setVehicleTrim}
                  autoComplete="off"
                />
              </InlineStack>
            </BlockStack>

            {/* Payment Card */}
            <Select
              label="Credit Card"
              options={[
                { label: 'Card 1', value: '1' },
                { label: 'Card 2', value: '2' },
                { label: 'Card 3', value: '3' },
                { label: 'Card 4', value: '4' },
                { label: 'Card 5', value: '5' },
              ]}
              value={selectedCard}
              onChange={setSelectedCard}
            />

            {/* Processing Mode */}
            <BlockStack gap="200">
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

            {/* Action Buttons */}
            <InlineStack gap="200">
              {processingSDW ? (
                <Button
                  tone="critical"
                  onClick={handleCancelProcessing}
                  loading={false}
                >
                  Cancel Processing
                </Button>
              ) : (
                <Button
                  primary
                  onClick={() => {/* TODO: Start processing */}}
                  disabled={selectedLineItems.length === 0}
                >
                  Process on SDW
                </Button>
              )}
            </InlineStack>

            {/* Progress */}
            {sdwProgress.length > 0 && (
              <BlockStack gap="200">
                <Text variant="bodyMd" fontWeight="semibold">Progress</Text>
                {sdwProgress.map((item, idx) => (
                  <Text key={idx} variant="bodySm">{item.message}</Text>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

export default OrderDetails;
