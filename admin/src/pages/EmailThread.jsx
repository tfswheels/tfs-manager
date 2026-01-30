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
import { decodeHTMLEntities } from '../utils/htmlDecode';
import './EmailThread.css';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function EmailThread() {
  const { conversationId } = useParams();
  const navigate = useNavigate();

  // Handle back navigation with fallback
  const handleBack = () => {
    // Check if there's browser history to go back to
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      // No history, go to tickets list
      navigate('/tickets');
    }
  };

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
  const [replyAttachments, setReplyAttachments] = useState([]);

  // Placeholder state
  const [availablePlaceholders, setAvailablePlaceholders] = useState([]);

  // Email attachments state (for displaying inline images)
  const [emailAttachments, setEmailAttachments] = useState([]);

  useEffect(() => {
    if (conversationId) {
      fetchConversation();
      fetchPlaceholders();
      fetchAttachments();
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

  const fetchAttachments = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/tickets/${conversationId}/attachments`,
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );
      setEmailAttachments(response.data.attachments || []);
    } catch (err) {
      console.error('Error fetching attachments:', err);
    }
  };

  /**
   * Process HTML content to replace cid: references and fix Zoho ImageDisplay URLs
   * @param {string} html - Original HTML content
   * @param {Array} attachments - Array of attachment objects
   * @returns {string} - Processed HTML with image URLs
   */
  const processInlineImages = (html, attachments) => {
    if (!html) {
      return html;
    }

    let processedHtml = html;

    // Replace cid: references if we have attachments
    if (attachments && attachments.length > 0) {
      // Find all inline attachments (those with content_id)
      const inlineAttachments = attachments.filter(att => att.is_inline && att.content_id);

      // Replace each cid: reference with the actual image URL
      inlineAttachments.forEach(attachment => {
        // Zoho uses content_id with angle brackets sometimes, so handle both
        const cidPatterns = [
          `cid:${attachment.content_id}`,
          `cid:${attachment.content_id.replace(/[<>]/g, '')}`,
          `cid:<${attachment.content_id.replace(/[<>]/g, '')}>`,
        ];

        cidPatterns.forEach(cidPattern => {
          const imageUrl = `${API_URL}${attachment.url}`;
          processedHtml = processedHtml.replace(new RegExp(cidPattern.replace(/[<>]/g, '\\$&'), 'g'), imageUrl);
        });
      });
    }

    // Fix Zoho ImageDisplay URLs
    // These are relative URLs like: /mail/ImageDisplay?na=...&nmsgId=...
    // Replace them with a clickable link that opens in Zoho Mail
    processedHtml = processedHtml.replace(
      /<img([^>]*?)src=["'](\/mail\/ImageDisplay\?[^"']*)["']([^>]*?)>/gi,
      (match, beforeSrc, imageDisplayUrl, afterSrc) => {
        // Extract alt text if available
        const altMatch = match.match(/alt=["']([^"']*)["']/i);
        const altText = altMatch ? altMatch[1] : 'Embedded image';

        // Decode HTML entities in URL (&amp; -> &)
        const decodedUrl = imageDisplayUrl.replace(/&amp;/g, '&');
        const fullUrl = `https://mail.zoho.com${decodedUrl}`;

        // Return a clickable link styled as a button
        return `<div style="padding: 12px; background: #f6f6f7; border: 1px solid #ddd; border-radius: 6px; margin: 8px 0;">
          <div style="margin-bottom: 8px; color: #666; font-size: 13px;">📷 ${decodeHTMLEntities(altText)}</div>
          <a href="${fullUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 16px; background: #005E99; color: white; text-decoration: none; border-radius: 4px; font-size: 13px; font-weight: 500;">
            View Image in Zoho Mail
          </a>
          <div style="margin-top: 6px; color: #999; font-size: 11px;">Opens in new tab (requires Zoho Mail login)</div>
        </div>`;
      }
    );

    return processedHtml;
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
      const attachmentPromises = replyAttachments.map(async (attachment) => {
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
          to: conversation.customer_email,
          toName: conversation.customer_name,
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
      setReplyAttachments([]);
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

    // Validate file sizes (10MB max per file)
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
    const invalidFiles = files.filter(file => file.size > MAX_FILE_SIZE);

    if (invalidFiles.length > 0) {
      const fileNames = invalidFiles.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)`).join(', ');
      alert(`The following files exceed the 10MB limit:\n${fileNames}\n\nPlease reduce file size or use multiple emails.`);
      event.target.value = ''; // Reset file input
      return;
    }

    const newAttachments = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      name: file.name,
      size: file.size,
      type: file.type
    }));
    setReplyAttachments([...replyAttachments, ...newAttachments]);
  };

  const removeAttachment = (id) => {
    setReplyAttachments(replyAttachments.filter(att => att.id !== id));
  };

  const handleDownloadAttachment = async (attachment) => {
    try {
      // Fetch attachment from backend
      const response = await axios.get(attachment.url, {
        params: { shop: '2f3d7a-2.myshopify.com' },
        responseType: 'blob' // Important: get binary data as blob
      });

      // Create blob URL and trigger download
      const blob = new Blob([response.data], { type: attachment.mime_type || 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.original_filename || attachment.filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading attachment:', error);
      alert('Failed to download attachment. Please try again.');
    }
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
        backAction={{ content: 'Back', onAction: handleBack }}
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
        backAction={{ content: 'Back', onAction: handleBack }}
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
      title={decodeHTMLEntities(conversation.subject) || '(No Subject)'}
      backAction={{ content: 'Back', onAction: handleBack }}
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
            {conversation.customer_email &&
             !['sales@tfswheels.com', 'support@tfswheels.com'].includes(conversation.customer_email?.toLowerCase()) && (
              <Card>
                <Box padding="400">
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Customer</Text>
                    <div>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">
                        {decodeHTMLEntities(conversation.customer_name) || 'Unknown'}
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        {decodeHTMLEntities(conversation.customer_email)}
                      </Text>
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

                      {replyAttachments.length > 0 && (
                        <div style={{ marginTop: '12px' }}>
                          <BlockStack gap="200">
                            {replyAttachments.map((attachment) => (
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
                              ? decodeHTMLEntities(message.from_name) || decodeHTMLEntities(message.from_email)
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
                        {decodeHTMLEntities(message.subject)}
                      </Text>
                    )}

                    <div className={`email-content ${message.direction === 'inbound' ? 'inbound' : 'outbound'}`}>
                      {message.body_html ? (
                        <div
                          className="email-html-content"
                          dangerouslySetInnerHTML={{ __html: processInlineImages(message.body_html, emailAttachments) }}
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
                                  <InlineStack gap="200">
                                    <Button
                                      size="slim"
                                      url={`${attachment.url}&view=true`}
                                      external
                                      target="_blank"
                                    >
                                      View
                                    </Button>
                                    <Button
                                      size="slim"
                                      onClick={() => handleDownloadAttachment(attachment)}
                                    >
                                      Download
                                    </Button>
                                  </InlineStack>
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
