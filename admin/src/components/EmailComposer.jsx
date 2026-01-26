import React, { useState, useEffect } from 'react';
import {
  Modal,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Select,
  Spinner,
  Banner,
  Card,
  Box,
  Badge,
  Popover,
  ActionList
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function EmailComposer({
  open,
  onClose,
  conversationId = null,
  orderId = null,
  customerData = null,
  replyTo = null,
  onSent
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // AI Generation
  const [aiPrompt, setAiPrompt] = useState('');
  const [showAiInput, setShowAiInput] = useState(false);
  const [aiCost, setAiCost] = useState(null);

  // Placeholders
  const [placeholderPopoverActive, setPlaceholderPopoverActive] = useState(false);

  const placeholders = [
    { label: 'Customer Name', value: '{{customer_name}}' },
    { label: 'Customer First Name', value: '{{customer_first_name}}' },
    { label: 'Order Number', value: '{{order_number}}' },
    { label: 'Vehicle (Full)', value: '{{vehicle_full}}' },
    { label: 'Vehicle Year', value: '{{vehicle_year}}' },
    { label: 'Vehicle Make', value: '{{vehicle_make}}' },
    { label: 'Vehicle Model', value: '{{vehicle_model}}' },
    { label: 'Wheel Brand', value: '{{wheel_brand}}' },
    { label: 'Wheel Model', value: '{{wheel_model}}' },
    { label: 'Tracking Number', value: '{{tracking_number}}' }
  ];

  useEffect(() => {
    if (replyTo) {
      const newSubject = replyTo.subject.startsWith('Re:')
        ? replyTo.subject
        : `Re: ${replyTo.subject}`;
      setSubject(newSubject);
    }
  }, [replyTo]);

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim()) {
      setError('Please enter a prompt for AI generation');
      return;
    }

    try {
      setGenerating(true);
      setError(null);

      const response = await axios.post(
        `${API_URL}/api/emails/ai/generate`,
        {
          prompt: aiPrompt,
          conversationId,
          orderId,
          customerData,
          voiceName: 'friendly' // Can make this selectable
        },
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      if (response.data.success) {
        setBody(response.data.content);
        setAiCost(response.data.metadata.cost_usd);
        setShowAiInput(false);
        setAiPrompt('');
      }
    } catch (err) {
      console.error('AI generation error:', err);
      setError(err.response?.data?.error || 'Failed to generate AI response');
    } finally {
      setGenerating(false);
    }
  };

  const insertPlaceholder = (placeholder) => {
    setBody(body + placeholder);
    setPlaceholderPopoverActive(false);
  };

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      setError('Subject and body are required');
      return;
    }

    try {
      setSending(true);
      setError(null);

      const emailData = {
        subject,
        bodyText: body,
        bodyHtml: body.replace(/\n/g, '<br>'), // Basic HTML conversion
        conversationId,
        orderId
      };

      if (replyTo) {
        emailData.to = replyTo.from_email;
        emailData.toName = replyTo.from_name;
        emailData.inReplyTo = replyTo.message_id;
        emailData.references = replyTo.references;
      } else if (customerData?.email) {
        emailData.to = customerData.email;
        emailData.toName = customerData.name;
      }

      const response = await axios.post(
        `${API_URL}/api/emails/send`,
        emailData,
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      if (response.data.success) {
        setSuccess(true);
        setTimeout(() => {
          onSent && onSent();
          handleClose();
        }, 1500);
      }
    } catch (err) {
      console.error('Send error:', err);
      setError(err.response?.data?.error || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setSubject('');
    setBody('');
    setError(null);
    setSuccess(false);
    setShowAiInput(false);
    setAiPrompt('');
    setAiCost(null);
    onClose();
  };

  const placeholderActivator = (
    <Button
      onClick={() => setPlaceholderPopoverActive(!placeholderPopoverActive)}
      disclosure
    >
      Insert Placeholder
    </Button>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={replyTo ? `Reply to ${replyTo.from_name || replyTo.from_email}` : 'Compose Email'}
      primaryAction={{
        content: 'Send Email',
        onAction: handleSend,
        loading: sending,
        disabled: generating || success
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: handleClose
        }
      ]}
      large
    >
      <Modal.Section>
        <BlockStack gap="400">
          {error && (
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          )}

          {success && (
            <Banner tone="success">
              Email sent successfully!
            </Banner>
          )}

          {aiCost && (
            <Banner tone="info">
              AI generated response • Cost: ${aiCost.toFixed(4)}
            </Banner>
          )}

          {/* AI Generation Section */}
          {!showAiInput ? (
            <Card>
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <div>
                    <Text variant="headingMd" as="h3">✨ AI Email Generation</Text>
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Let Claude write a professional response for you
                    </Text>
                  </div>
                  <Button onClick={() => setShowAiInput(true)}>
                    Generate with AI
                  </Button>
                </InlineStack>
              </Box>
            </Card>
          ) : (
            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h3">🤖 AI Email Generator</Text>

                  <TextField
                    label="What should this email say?"
                    value={aiPrompt}
                    onChange={setAiPrompt}
                    placeholder="E.g., 'Thank the customer for their purchase' or 'Apologize for the delay and offer a discount'"
                    autoComplete="off"
                    multiline={3}
                  />

                  <InlineStack gap="200">
                    <Button
                      primary
                      onClick={handleGenerateAI}
                      loading={generating}
                      disabled={!aiPrompt.trim()}
                    >
                      {generating ? 'Generating...' : 'Generate Email'}
                    </Button>
                    <Button onClick={() => setShowAiInput(false)}>
                      Cancel
                    </Button>
                  </InlineStack>

                  {generating && (
                    <InlineStack gap="200" blockAlign="center">
                      <Spinner size="small" />
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Claude is writing your email... (~$0.03)
                      </Text>
                    </InlineStack>
                  )}
                </BlockStack>
              </Box>
            </Card>
          )}

          <TextField
            label="Subject"
            value={subject}
            onChange={setSubject}
            autoComplete="off"
            placeholder="Email subject"
          />

          <div>
            <div style={{ marginBottom: '8px' }}>
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="bodyMd" as="label" fontWeight="semibold">
                  Message
                </Text>
                <Popover
                  active={placeholderPopoverActive}
                  activator={placeholderActivator}
                  onClose={() => setPlaceholderPopoverActive(false)}
                >
                  <ActionList
                    items={placeholders.map(ph => ({
                      content: (
                        <InlineStack gap="200" blockAlign="center">
                          <Text variant="bodyMd" as="span">{ph.label}</Text>
                          <Badge tone="info">{ph.value}</Badge>
                        </InlineStack>
                      ),
                      onAction: () => insertPlaceholder(ph.value)
                    }))}
                  />
                </Popover>
              </InlineStack>
            </div>

            <TextField
              value={body}
              onChange={setBody}
              multiline={12}
              autoComplete="off"
              placeholder="Type your message here... Use the 'Insert Placeholder' button to add dynamic customer data."
              helpText="Placeholders like {{customer_name}} and {{order_number}} will be replaced with actual data when sent."
            />
          </div>

          {replyTo && (
            <Card>
              <Box padding="400" background="bg-surface-secondary">
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h4">Original Message</Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    <strong>From:</strong> {replyTo.from_email}
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    <strong>Date:</strong> {new Date(replyTo.received_at).toLocaleString()}
                  </Text>
                  <div style={{
                    marginTop: '12px',
                    padding: '12px',
                    background: 'white',
                    borderRadius: '4px',
                    maxHeight: '200px',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontSize: '13px'
                  }}>
                    {replyTo.body_text}
                  </div>
                </BlockStack>
              </Box>
            </Card>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
