import React, { useState, useEffect } from 'react';
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  Banner,
  Spinner,
  Box,
  TextField,
  Select,
  Icon
} from '@shopify/polaris';
import { ArrowLeftIcon } from '@shopify/polaris-icons';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function EmailThread() {
  const { conversationId } = useParams();
  const navigate = useNavigate();

  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generatingReply, setGeneratingReply] = useState(false);

  // Reply state
  const [replyBody, setReplyBody] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [showReplyBox, setShowReplyBox] = useState(false);

  // Placeholder state
  const [availablePlaceholders, setAvailablePlaceholders] = useState([]);

  useEffect(() => {
    if (conversationId) {
      fetchConversation();
      fetchPlaceholders();
    }
  }, [conversationId]);

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

      const conv = response.data.conversation;
      setConversation(conv);

      // Set reply subject
      if (conv.subject && !conv.subject.startsWith('Re:')) {
        setReplySubject(`Re: ${conv.subject}`);
      } else {
        setReplySubject(conv.subject || 'Re: ');
      }
    } catch (err) {
      console.error('Error fetching conversation:', err);
      setError(err.response?.data?.error || 'Failed to load conversation');
    } finally {
      setLoading(false);
    }
  };

  const fetchPlaceholders = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/emails/placeholders`);
      setAvailablePlaceholders(response.data.placeholders || []);
    } catch (err) {
      console.error('Error fetching placeholders:', err);
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

  const handleGenerateAIReply = async () => {
    try {
      setGeneratingReply(true);

      const response = await axios.post(
        `${API_URL}/api/emails/ai/generate`,
        {
          conversationId: conversationId,
          orderId: conversation?.order?.id,
          customerEmail: conversation?.customer?.email,
          customerName: conversation?.customer?.name,
          voiceName: 'friendly'
          // No prompt - let AI auto-suggest based on full thread history
        },
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      setReplyBody(response.data.content);
      setShowReplyBox(true);
    } catch (err) {
      console.error('Error generating AI reply:', err);
      alert('Failed to generate AI reply');
    } finally {
      setGeneratingReply(false);
    }
  };

  const handleSendReply = async () => {
    try {
      setSendingReply(true);

      const latestMessage = conversation.messages?.[conversation.messages.length - 1];

      await axios.post(
        `${API_URL}/api/emails/send`,
        {
          to: conversation.customer.email,
          toName: conversation.customer.name,
          subject: replySubject,
          body: replyBody,
          bodyHtml: replyBody.replace(/\n/g, '<br>'),
          fromAddress: 'sales@tfswheels.com',
          fromName: 'TFS Wheels',
          conversationId: conversationId,
          orderId: conversation?.order?.id,
          inReplyTo: latestMessage?.message_id,
          references: latestMessage?.references || latestMessage?.message_id
        },
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      // Refresh conversation
      setReplyBody('');
      setShowReplyBox(false);
      fetchConversation();
    } catch (err) {
      console.error('Error sending reply:', err);
      alert('Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  const insertPlaceholder = (placeholder) => {
    setReplyBody(replyBody + `{{${placeholder}}}`);
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
      <Page
        title="Loading..."
        backAction={{ content: 'Emails', onAction: () => navigate('/emails') }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 0' }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page
        title="Error"
        backAction={{ content: 'Emails', onAction: () => navigate('/emails') }}
      >
        <Banner tone="critical">
          <p>{error}</p>
          <div style={{ marginTop: '16px' }}>
            <Button onClick={fetchConversation}>Retry</Button>
          </div>
        </Banner>
      </Page>
    );
  }

  if (!conversation) {
    return null;
  }

  return (
    <Page
      title={conversation.subject || '(No Subject)'}
      backAction={{ content: 'Emails', onAction: () => navigate('/emails') }}
      primaryAction={{
        content: 'Reply with AI',
        onAction: handleGenerateAIReply,
        loading: generatingReply
      }}
      secondaryActions={[
        {
          content: 'Manual Reply',
          onAction: () => setShowReplyBox(!showReplyBox)
        }
      ]}
    >
      <Layout>
        {/* Main Content - Email Thread */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* AI Summary */}
            <Card>
              <Box padding="400">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h3">
                      AI Summary
                    </Text>
                    <Button
                      size="slim"
                      onClick={handleGenerateSummary}
                      loading={generatingSummary}
                    >
                      {conversation.ai_summary ? 'Regenerate' : 'Generate'}
                    </Button>
                  </InlineStack>

                  {conversation.ai_summary ? (
                    <>
                      <Text variant="bodyMd" as="p">
                        {conversation.ai_summary}
                      </Text>
                      {conversation.ai_summary_generated_at && (
                        <Text variant="bodySm" as="p" tone="subdued">
                          Generated {formatDate(conversation.ai_summary_generated_at)}
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Generate an AI summary of this conversation thread
                    </Text>
                  )}
                </BlockStack>
              </Box>
            </Card>

            {/* Order Details */}
            {conversation.order && (
              <Card>
                <Box padding="400">
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Order Details</Text>
                    <div>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        Order Number
                      </Text>
                      <Button
                        plain
                        onClick={() => navigate(`/orders/${conversation.order.id}`)}
                      >
                        #{conversation.order.order_number}
                      </Button>
                    </div>

                    {conversation.order.vehicle && (
                      <>
                        <Divider />
                        <div>
                          <Text variant="bodyMd" as="p" fontWeight="semibold">
                            Vehicle
                          </Text>
                          <Text variant="bodyMd" as="p">
                            {conversation.vehicle_full || [
                              conversation.order.vehicle.year,
                              conversation.order.vehicle.make,
                              conversation.order.vehicle.model,
                              conversation.order.vehicle.trim
                            ].filter(Boolean).join(' ')}
                          </Text>
                        </div>
                      </>
                    )}
                  </BlockStack>
                </Box>
              </Card>
            )}

            {/* Customer Details */}
            {conversation.customer && (
              <Card>
                <Box padding="400">
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Customer</Text>
                    <div>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        {conversation.customer.name || 'Unknown'}
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        {conversation.customer.email}
                      </Text>
                      {conversation.customer.phone && (
                        <Text variant="bodyMd" as="p" tone="subdued">
                          {conversation.customer.phone}
                        </Text>
                      )}
                    </div>
                  </BlockStack>
                </Box>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>

        {/* Sidebar - Thread Messages */}
        <Layout.Section>
          <BlockStack gap="400">
            {/* Reply Box */}
            {showReplyBox && (
              <Card>
                <Box padding="400">
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h3">Reply</Text>

                    {/* Placeholders */}
                    {availablePlaceholders.length > 0 && (
                      <Box padding="200" background="bg-surface-secondary">
                        <BlockStack gap="200">
                          <Text variant="bodyMd" as="p" fontWeight="semibold">
                            Quick Insert:
                          </Text>
                          <InlineStack gap="200" wrap>
                            {availablePlaceholders.slice(0, 10).map((ph) => (
                              <Button
                                key={ph.key}
                                size="slim"
                                onClick={() => insertPlaceholder(ph.key)}
                              >
                                {ph.label}
                              </Button>
                            ))}
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    )}

                    <TextField
                      label="Subject"
                      value={replySubject}
                      onChange={setReplySubject}
                      autoComplete="off"
                    />

                    <TextField
                      label="Message"
                      value={replyBody}
                      onChange={setReplyBody}
                      multiline={10}
                      autoComplete="off"
                    />

                    <InlineStack gap="200">
                      <Button
                        primary
                        onClick={handleSendReply}
                        loading={sendingReply}
                      >
                        Send Reply
                      </Button>
                      <Button onClick={() => setShowReplyBox(false)}>
                        Cancel
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </Card>
            )}

            {/* Message Thread */}
            <Text variant="headingLg" as="h2">
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
        </Layout.Section>
      </Layout>
    </Page>
  );
}
