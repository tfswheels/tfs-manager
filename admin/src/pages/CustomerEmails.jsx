import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  DataTable,
  Button,
  Modal,
  TextField,
  Badge,
  Banner,
  Spinner,
  EmptyState,
  Text,
  BlockStack,
  InlineStack,
  Tabs,
  Box,
  Divider
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function CustomerEmails() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState({ total: 0, unread: 0, read: 0, replied: 0, archived: 0 });

  // Email detail modal
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [emailDetailOpen, setEmailDetailOpen] = useState(false);

  // Reply modal
  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const tabs = [
    { id: 'all', content: 'All', status: '' },
    { id: 'unread', content: 'Unread', status: 'unread' },
    { id: 'read', content: 'Read', status: 'read' },
    { id: 'replied', content: 'Replied', status: 'replied' },
    { id: 'archived', content: 'Archived', status: 'archived' }
  ];

  useEffect(() => {
    fetchEmails();
    fetchStats();
  }, [selectedTab, page]);

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/customer-emails/stats/summary`, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      setStats(response.data.stats);
    } catch (err) {
      console.error('Error fetching email stats:', err);
    }
  };

  const fetchEmails = async () => {
    try {
      setLoading(true);
      setError(null);

      const status = tabs[selectedTab].status;

      const response = await axios.get(`${API_URL}/api/customer-emails`, {
        params: {
          shop: '2f3d7a-2.myshopify.com',
          limit: 50,
          page: page,
          status: status
        }
      });

      setEmails(response.data.emails || []);
      setTotal(response.data.total || 0);
      setHasMore(response.data.hasMore || false);
    } catch (err) {
      console.error('Error fetching emails:', err);
      setError(err.response?.data?.message || 'Failed to load emails');
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tabIndex) => {
    setSelectedTab(tabIndex);
    setPage(1);
  };

  const handleEmailClick = async (email) => {
    try {
      // Fetch full email details
      const response = await axios.get(`${API_URL}/api/customer-emails/${email.id}`, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      setSelectedEmail(response.data.email);
      setEmailDetailOpen(true);

      // Refresh list and stats after marking as read
      fetchEmails();
      fetchStats();
    } catch (err) {
      console.error('Error fetching email details:', err);
      alert('Failed to load email details');
    }
  };

  const openReplyModal = () => {
    if (!selectedEmail) return;

    const subject = selectedEmail.subject.startsWith('Re:')
      ? selectedEmail.subject
      : `Re: ${selectedEmail.subject}`;

    setReplySubject(subject);
    setReplyBody('');
    setReplyModalOpen(true);
  };

  const handleSendReply = async () => {
    if (!replySubject || !replyBody) {
      alert('Please enter both subject and body');
      return;
    }

    try {
      setSendingReply(true);

      await axios.post(
        `${API_URL}/api/customer-emails/${selectedEmail.id}/reply`,
        {
          subject: replySubject,
          body: replyBody
        },
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      alert('Reply sent successfully!');
      setReplyModalOpen(false);
      setEmailDetailOpen(false);
      fetchEmails();
      fetchStats();
    } catch (err) {
      console.error('Error sending reply:', err);
      alert(err.response?.data?.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  const handleUpdateStatus = async (emailId, newStatus) => {
    try {
      await axios.patch(
        `${API_URL}/api/customer-emails/${emailId}/status`,
        { status: newStatus },
        {
          params: {
            shop: '2f3d7a-2.myshopify.com'
          }
        }
      );

      fetchEmails();
      fetchStats();
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Failed to update status');
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

  const getStatusBadge = (status) => {
    const statusMap = {
      unread: { tone: 'attention', label: 'Unread' },
      read: { tone: 'info', label: 'Read' },
      replied: { tone: 'success', label: 'Replied' },
      archived: { tone: 'subdued', label: 'Archived' }
    };

    const config = statusMap[status] || { tone: 'info', label: status };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  };

  const rows = emails.map((email) => [
    <Button plain onClick={() => handleEmailClick(email)}>
      <Text variant="bodyMd" as="span" fontWeight={email.status === 'unread' ? 'semibold' : 'regular'}>
        {email.from_name || email.from_email}
      </Text>
    </Button>,
    <Text variant="bodyMd" as="span" fontWeight={email.status === 'unread' ? 'semibold' : 'regular'}>
      {email.subject || '(No Subject)'}
    </Text>,
    email.order_number ? (
      <Button plain size="slim">
        {email.order_number}
      </Button>
    ) : '-',
    getStatusBadge(email.status),
    formatDate(email.received_at)
  ]);

  const headings = ['From', 'Subject', 'Order', 'Status', 'Received'];

  if (loading && emails.length === 0) {
    return (
      <Page title="Customer Emails">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 0' }}>
          <Spinner size="large" />
          <Text variant="bodyMd" as="p" tone="subdued" style={{ marginLeft: '12px' }}>
            Loading emails...
          </Text>
        </div>
      </Page>
    );
  }

  if (error && emails.length === 0) {
    return (
      <Page title="Customer Emails">
        <Banner tone="critical" title="Error loading emails">
          <p>{error}</p>
          <div style={{ marginTop: '16px' }}>
            <Button onClick={() => fetchEmails()}>Retry</Button>
          </div>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Customer Emails"
      subtitle={`${total} total email${total !== 1 ? 's' : ''}`}
      secondaryActions={[
        {
          content: 'Refresh',
          onAction: () => {
            fetchEmails();
            fetchStats();
          }
        }
      ]}
    >
      <BlockStack gap="400">
        {/* Stats Cards */}
        <InlineStack gap="400">
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p" tone="subdued">Unread</Text>
                <Text variant="heading2xl" as="h2">{stats.unread}</Text>
              </BlockStack>
            </Box>
          </Card>
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p" tone="subdued">Total</Text>
                <Text variant="heading2xl" as="h2">{stats.total}</Text>
              </BlockStack>
            </Box>
          </Card>
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p" tone="subdued">Replied</Text>
                <Text variant="heading2xl" as="h2">{stats.replied}</Text>
              </BlockStack>
            </Box>
          </Card>
        </InlineStack>

        {/* Emails Table */}
        <Card>
          <Tabs tabs={tabs.map((tab, index) => ({
            ...tab,
            content: `${tab.content}${tab.status === 'unread' ? ` (${stats.unread})` : ''}`
          }))} selected={selectedTab} onSelect={handleTabChange}>
            {emails.length === 0 && !loading ? (
              <Box padding="800">
                <EmptyState
                  heading="No emails found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Customer emails will appear here when received.</p>
                </EmptyState>
              </Box>
            ) : (
              <>
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                  headings={headings}
                  rows={rows}
                  hoverable
                />

                <Divider />

                {/* Pagination */}
                <Box padding="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Showing {emails.length} of {total} email{total !== 1 ? 's' : ''}
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
          </Tabs>
        </Card>
      </BlockStack>

      {/* Email Detail Modal */}
      {selectedEmail && (
        <Modal
          open={emailDetailOpen}
          onClose={() => setEmailDetailOpen(false)}
          title={`Email from ${selectedEmail.from_name || selectedEmail.from_email}`}
          primaryAction={{
            content: 'Reply',
            onAction: openReplyModal
          }}
          secondaryActions={[
            {
              content: 'Mark as Unread',
              onAction: () => handleUpdateStatus(selectedEmail.id, 'unread')
            },
            {
              content: 'Archive',
              onAction: () => {
                handleUpdateStatus(selectedEmail.id, 'archived');
                setEmailDetailOpen(false);
              }
            },
            {
              content: 'Close',
              onAction: () => setEmailDetailOpen(false)
            }
          ]}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <div>
                  <Text variant="headingMd" as="h3">
                    {selectedEmail.subject || '(No Subject)'}
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    From: {selectedEmail.from_email}
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Received: {formatDate(selectedEmail.received_at)}
                  </Text>
                </div>
                <div>
                  {getStatusBadge(selectedEmail.status)}
                </div>
              </InlineStack>

              {selectedEmail.order_number && (
                <Card>
                  <Box padding="400">
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h4">Associated Order</Text>
                      <InlineStack gap="400">
                        <div>
                          <Text variant="bodyMd" as="p">
                            <strong>Order #:</strong> {selectedEmail.order_number}
                          </Text>
                          <Text variant="bodyMd" as="p">
                            <strong>Customer:</strong> {selectedEmail.customer_name}
                          </Text>
                        </div>
                        {(selectedEmail.vehicle_year || selectedEmail.vehicle_make) && (
                          <div>
                            <Text variant="bodyMd" as="p">
                              <strong>Vehicle:</strong> {[
                                selectedEmail.vehicle_year,
                                selectedEmail.vehicle_make,
                                selectedEmail.vehicle_model,
                                selectedEmail.vehicle_trim
                              ].filter(Boolean).join(' ')}
                            </Text>
                          </div>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </Card>
              )}

              <Divider />

              <div style={{
                padding: '16px',
                background: '#f6f6f7',
                borderRadius: '8px',
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: '13px'
              }}>
                {selectedEmail.body_text || '(No content)'}
              </div>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Reply Modal */}
      <Modal
        open={replyModalOpen}
        onClose={() => setReplyModalOpen(false)}
        title="Reply to Email"
        primaryAction={{
          content: 'Send Reply',
          onAction: handleSendReply,
          loading: sendingReply
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setReplyModalOpen(false)
          }
        ]}
        large
      >
        <Modal.Section>
          <BlockStack gap="400">
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
              placeholder="Type your reply here..."
            />

            {selectedEmail && (
              <div style={{ padding: '12px', background: '#f6f6f7', borderRadius: '8px' }}>
                <Text variant="bodyMd" as="p" tone="subdued">
                  Replying to: {selectedEmail.from_email}
                </Text>
              </div>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
