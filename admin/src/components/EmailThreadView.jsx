import React, { useState, useEffect } from 'react';
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Card,
  Box,
  Badge,
  Button,
  Divider,
  Banner,
  Spinner
} from '@shopify/polaris';
import axios from 'axios';
import EmailComposer from './EmailComposer';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function EmailThreadView({ conversationId, open, onClose }) {
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);

  useEffect(() => {
    if (open && conversationId) {
      fetchConversation();
    }
  }, [open, conversationId]);

  const fetchConversation = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await axios.get(
        `${API_URL}/api/emails/conversations/${conversationId}`,
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      setConversation(response.data.conversation);
    } catch (err) {
      console.error('Error fetching conversation:', err);
      setError(err.response?.data?.error || 'Failed to load conversation');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSummary = async () => {
    try {
      setGeneratingSummary(true);

      const response = await axios.post(
        `${API_URL}/api/emails/conversations/${conversationId}/summary`,
        {},
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      // Refresh conversation to get new summary
      fetchConversation();
    } catch (err) {
      console.error('Error generating summary:', err);
      alert('Failed to generate summary');
    } finally {
      setGeneratingSummary(false);
    }
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getDirectionBadge = (direction) => {
    return direction === 'inbound' ? (
      <Badge tone="info">From Customer</Badge>
    ) : (
      <Badge tone="success">From Us</Badge>
    );
  };

  if (loading) {
    return (
      <Modal open={open} onClose={onClose} title="Loading..." large>
        <Modal.Section>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Spinner size="large" />
          </div>
        </Modal.Section>
      </Modal>
    );
  }

  if (error) {
    return (
      <Modal open={open} onClose={onClose} title="Error" large>
        <Modal.Section>
          <Banner tone="critical">
            {error}
          </Banner>
        </Modal.Section>
      </Modal>
    );
  }

  if (!conversation) {
    return null;
  }

  const latestMessage = conversation.messages?.[conversation.messages.length - 1];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Conversation: ${conversation.subject}`}
        primaryAction={{
          content: 'Reply',
          onAction: () => setComposerOpen(true)
        }}
        secondaryActions={[
          {
            content: 'Close',
            onAction: onClose
          }
        ]}
        large
      >
        <Modal.Section>
          <BlockStack gap="400">
            {/* AI Summary */}
            {conversation.ai_summary ? (
              <Card>
                <Box padding="400" background="bg-surface-success">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h3">
                        🤖 AI Summary
                      </Text>
                      <Button
                        size="slim"
                        onClick={handleGenerateSummary}
                        loading={generatingSummary}
                      >
                        Regenerate
                      </Button>
                    </InlineStack>
                    <Text variant="bodyMd" as="p">
                      {conversation.ai_summary}
                    </Text>
                    {conversation.ai_summary_generated_at && (
                      <Text variant="bodySm" as="p" tone="subdued">
                        Generated {formatDate(conversation.ai_summary_generated_at)}
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              </Card>
            ) : (
              <Card>
                <Box padding="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <div>
                      <Text variant="headingMd" as="h3">AI Summary</Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Generate an AI summary of this conversation
                      </Text>
                    </div>
                    <Button
                      onClick={handleGenerateSummary}
                      loading={generatingSummary}
                    >
                      Generate Summary
                    </Button>
                  </InlineStack>
                </Box>
              </Card>
            )}

            {/* Customer/Order Info Sidebar */}
            {(conversation.customer || conversation.order) && (
              <Card>
                <Box padding="400">
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Details</Text>

                    {conversation.customer_email && (
                      <div>
                        <Text variant="bodyMd" as="p" fontWeight="semibold">
                          Customer
                        </Text>
                        <Text variant="bodyMd" as="p">
                          {conversation.customer_name || 'Unknown'}
                        </Text>
                        <Text variant="bodyMd" as="p" tone="subdued">
                          {conversation.customer_email}
                        </Text>
                      </div>
                    )}

                    {conversation.order && (
                      <>
                        <Divider />
                        <div>
                          <Text variant="bodyMd" as="p" fontWeight="semibold">
                            Order
                          </Text>
                          <Text variant="bodyMd" as="p">
                            #{conversation.order.order_number}
                          </Text>
                          {conversation.order.vehicle && (
                            <Text variant="bodyMd" as="p" tone="subdued">
                              {[
                                conversation.order.vehicle.year,
                                conversation.order.vehicle.make,
                                conversation.order.vehicle.model
                              ].filter(Boolean).join(' ')}
                            </Text>
                          )}
                        </div>
                      </>
                    )}
                  </BlockStack>
                </Box>
              </Card>
            )}

            <Divider />

            {/* Message Thread */}
            <Text variant="headingMd" as="h3">
              {conversation.messages?.length || 0} Message{conversation.messages?.length !== 1 ? 's' : ''}
            </Text>

            {conversation.messages?.map((message, index) => (
              <Card key={message.id}>
                <Box padding="400">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <div>
                        <InlineStack gap="200" blockAlign="center">
                          <Text variant="headingMd" as="h4">
                            {message.direction === 'inbound'
                              ? message.from_name || message.from_email
                              : 'TFS Wheels'}
                          </Text>
                          {getDirectionBadge(message.direction)}
                        </InlineStack>
                        <Text variant="bodySm" as="p" tone="subdued">
                          {formatDate(message.sent_at || message.received_at)}
                        </Text>
                      </div>

                      {message.opened_at && (
                        <Badge tone="success">Opened</Badge>
                      )}
                    </InlineStack>

                    {message.subject && index === 0 && (
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        {message.subject}
                      </Text>
                    )}

                    <div style={{
                      padding: '16px',
                      background: message.direction === 'inbound' ? '#f6f6f7' : '#e3f5ff',
                      borderRadius: '8px',
                      whiteSpace: 'pre-wrap',
                      fontSize: '14px',
                      lineHeight: '1.5'
                    }}>
                      {message.body_html ? (
                        <div dangerouslySetInnerHTML={{ __html: message.body_html }} />
                      ) : (
                        message.body_text || '(No content)'
                      )}
                    </div>

                    {message.clicked_at && (
                      <Text variant="bodySm" as="p" tone="subdued">
                        ✓ Link clicked at {formatDate(message.clicked_at)}
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              </Card>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Email Composer */}
      <EmailComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        conversationId={conversationId}
        orderId={conversation?.order?.id}
        customerData={conversation?.customer}
        replyTo={latestMessage}
        onSent={() => {
          fetchConversation();
          onClose();
        }}
      />
    </>
  );
}
