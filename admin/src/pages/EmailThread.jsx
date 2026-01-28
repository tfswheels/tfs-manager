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
import RichTextEditor from '../components/RichTextEditor';
import './EmailThread.css';

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
  const [attachments, setAttachments] = useState([]);

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
        `${API_URL}/api/tickets/${conversationId}`,
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      // New tickets API returns data in different structure
      const ticketData = response.data.ticket;
      const messages = response.data.messages || [];

      // Transform to expected format
      const conv = {
        ...ticketData,
        messages: messages
      };

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

      // Convert HTML to plain text for body field
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = replyBody;
      const plainTextBody = tempDiv.textContent || tempDiv.innerText || '';

      // Convert attachments to base64
      const attachmentPromises = attachments.map(async (attachment) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result.split(',')[1]; // Remove data URL prefix
            resolve({
              filename: attachment.name,
              content: base64,
              contentType: attachment.type
            });
          };
          reader.onerror = reject;
          reader.readAsDataURL(attachment.file);
        });
      });

      const attachmentData = await Promise.all(attachmentPromises);

      await axios.post(
        `${API_URL}/api/emails/send`,
        {
          to: conversation.customer.email,
          toName: conversation.customer.name,
          subject: replySubject,
          body: plainTextBody,
          bodyHtml: replyBody,
          fromAddress: 'sales@tfswheels.com',
          fromName: 'TFS Wheels',
          conversationId: conversationId,
          orderId: conversation?.order?.id,
          inReplyTo: latestMessage?.message_id,
          references: latestMessage?.references || latestMessage?.message_id,
          attachments: attachmentData
        },
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      // Refresh conversation
      setReplyBody('');
      setAttachments([]);
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
    // Append placeholder to HTML content
    // TipTap will parse and render it properly
    const placeholderText = `{{${placeholder}}}`;
    setReplyBody(replyBody + ` ${placeholderText} `);
  };

  const handleFileSelect = (event) => {
    const files = Array.from(event.target.files);
    const newAttachments = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      name: file.name,
      size: file.size,
      type: file.type
    }));
    setAttachments([...attachments, ...newAttachments]);
  };

  const removeAttachment = (id) => {
    setAttachments(attachments.filter(att => att.id !== id));
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateOrEmail) => {
    let date;

    // If it's an object (email message), try multiple date fields
    if (typeof dateOrEmail === 'object' && dateOrEmail !== null) {
      date = dateOrEmail.received_at || dateOrEmail.sent_at || dateOrEmail.created_at;
    } else {
      // Otherwise it's a direct date string
      date = dateOrEmail;
    }

    if (!date) return 'Unknown date';
    const dateObj = new Date(date);
    // Check if date is valid (not epoch 0 or invalid)
    if (isNaN(dateObj.getTime()) || dateObj.getTime() === 0) {
      return 'Unknown date';
    }
    return dateObj.toLocaleString('en-US', {
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
        content: 'Reply',
        onAction: () => setShowReplyBox(!showReplyBox)
      }}
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
                        onClick={() => navigate(`/orders/${conversation.order.shopify_order_id}`)}
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
            {conversation.customer &&
             !['sales@tfswheels.com', 'support@tfswheels.com'].includes(conversation.customer.email?.toLowerCase()) && (
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

                    {/* Past Orders */}
                    {conversation.customer.pastOrders && conversation.customer.pastOrders.length > 0 && (
                      <>
                        <Divider />
                        <div>
                          <Text variant="bodyMd" as="p" fontWeight="semibold">
                            Past Orders
                          </Text>
                          <BlockStack gap="200">
                            {conversation.customer.pastOrders.map((order) => (
                              <div key={order.id}>
                                <Button
                                  plain
                                  onClick={() => navigate(`/orders/${order.shopify_order_id}`)}
                                >
                                  #{order.order_number}
                                </Button>
                                <Text variant="bodySm" as="p" tone="subdued">
                                  {new Date(order.created_at).toLocaleDateString()} - ${parseFloat(order.total_price || 0).toFixed(2)}
                                </Text>
                              </div>
                            ))}
                          </BlockStack>
                        </div>
                      </>
                    )}

                    {conversation.customer.pastOrders && conversation.customer.pastOrders.length === 0 && (
                      <>
                        <Divider />
                        <Text variant="bodySm" as="p" tone="subdued">
                          No previous orders
                        </Text>
                      </>
                    )}
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
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h3">Reply</Text>
                      <Button
                        onClick={handleGenerateAIReply}
                        loading={generatingReply}
                      >
                        Generate with AI
                      </Button>
                    </InlineStack>

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

                    <div>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        Message
                      </Text>
                      <div style={{ marginTop: '8px' }}>
                        <RichTextEditor
                          content={replyBody}
                          onChange={setReplyBody}
                          placeholder="Write your message..."
                        />
                      </div>
                    </div>

                    {/* Attachments */}
                    <div>
                      <input
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                        id="attachment-input"
                      />
                      <Button
                        onClick={() => document.getElementById('attachment-input').click()}
                        size="slim"
                      >
                        Attach Files
                      </Button>

                      {attachments.length > 0 && (
                        <div style={{ marginTop: '12px' }}>
                          <BlockStack gap="200">
                            {attachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                style={{
                                  padding: '8px 12px',
                                  background: '#f6f6f7',
                                  borderRadius: '6px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}
                              >
                                <div>
                                  <Text variant="bodyMd" as="p" fontWeight="semibold">
                                    {attachment.name}
                                  </Text>
                                  <Text variant="bodySm" as="p" tone="subdued">
                                    {formatFileSize(attachment.size)}
                                  </Text>
                                </div>
                                <Button
                                  size="slim"
                                  onClick={() => removeAttachment(attachment.id)}
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </BlockStack>
                        </div>
                      )}
                    </div>

                    <InlineStack gap="200">
                      <Button
                        primary
                        onClick={handleSendReply}
                        loading={sendingReply}
                        disabled={sendingReply}
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
                          {formatDate(message)}
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

                    <div className={`email-content ${message.direction === 'inbound' ? 'inbound' : 'outbound'}`}>
                      {message.body_html ? (
                        <div
                          className="email-html-content"
                          dangerouslySetInnerHTML={{ __html: message.body_html }}
                        />
                      ) : (
                        <div className="email-text-content">
                          {message.body_text || '(No content)'}
                        </div>
                      )}
                    </div>

                    {/* Attachments */}
                    {message.attachments && message.attachments.length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <Text variant="bodyMd" as="p" fontWeight="semibold">
                          Attachments ({message.attachments.length})
                        </Text>
                        <div style={{ marginTop: '8px' }}>
                          <BlockStack gap="200">
                            {message.attachments.map((attachment, attIndex) => (
                              <div
                                key={attIndex}
                                style={{
                                  padding: '8px 12px',
                                  background: '#f6f6f7',
                                  borderRadius: '6px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}
                              >
                                <div>
                                  <Text variant="bodyMd" as="p">
                                    📎 {attachment.filename || attachment.name || 'Untitled'}
                                  </Text>
                                  {attachment.size && (
                                    <Text variant="bodySm" as="p" tone="subdued">
                                      {formatFileSize(attachment.size)}
                                    </Text>
                                  )}
                                </div>
                                {attachment.url && (
                                  <Button
                                    size="slim"
                                    url={attachment.url}
                                    external
                                  >
                                    Download
                                  </Button>
                                )}
                              </div>
                            ))}
                          </BlockStack>
                        </div>
                      </div>
                    )}

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
