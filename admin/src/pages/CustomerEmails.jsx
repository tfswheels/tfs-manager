import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  DataTable,
  Button,
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
import EmailThreadView from '../components/EmailThreadView';
import EmailComposer from '../components/EmailComposer';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function CustomerEmails() {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState({ total: 0, unread: 0, read: 0, replied: 0, archived: 0 });

  // Thread view modal
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [threadViewOpen, setThreadViewOpen] = useState(false);

  // New email composer
  const [composerOpen, setComposerOpen] = useState(false);

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
      const offset = (page - 1) * 50;

      const response = await axios.get(`${API_URL}/api/emails/conversations`, {
        params: {
          shop: '2f3d7a-2.myshopify.com',
          limit: 50,
          offset: offset,
          unreadOnly: status === 'unread'
        }
      });

      setConversations(response.data.conversations || []);
      setTotal(response.data.total || 0);
      setHasMore((page * 50) < response.data.total);
    } catch (err) {
      console.error('Error fetching conversations:', err);
      setError(err.response?.data?.error || 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tabIndex) => {
    setSelectedTab(tabIndex);
    setPage(1);
  };

  const handleConversationClick = (conversationId) => {
    setSelectedConversationId(conversationId);
    setThreadViewOpen(true);
  };

  const handleThreadViewClose = () => {
    setThreadViewOpen(false);
    setSelectedConversationId(null);
    fetchEmails();
    fetchStats();
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

  const rows = conversations.map((conv) => [
    <Button plain onClick={() => handleConversationClick(conv.id)}>
      <Text variant="bodyMd" as="span" fontWeight={conv.unread_count > 0 ? 'semibold' : 'regular'}>
        {conv.customer_name || conv.customer_email}
      </Text>
    </Button>,
    <Button plain onClick={() => handleConversationClick(conv.id)}>
      <Text variant="bodyMd" as="span" fontWeight={conv.unread_count > 0 ? 'semibold' : 'regular'}>
        {conv.subject || '(No Subject)'}
      </Text>
    </Button>,
    <InlineStack gap="100">
      <Badge tone="info">{conv.message_count || 0}</Badge>
      {conv.unread_count > 0 && (
        <Badge tone="attention">{conv.unread_count} new</Badge>
      )}
    </InlineStack>,
    conv.order_id ? (
      <Button plain size="slim">
        {conv.order_id}
      </Button>
    ) : '-',
    formatDate(conv.last_message_at)
  ]);

  const headings = ['From', 'Subject', 'Messages', 'Order', 'Last Activity'];

  if (loading && conversations.length === 0) {
    return (
      <Page title="Customer Emails">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 0' }}>
          <Spinner size="large" />
          <Text variant="bodyMd" as="p" tone="subdued" style={{ marginLeft: '12px' }}>
            Loading conversations...
          </Text>
        </div>
      </Page>
    );
  }

  if (error && conversations.length === 0) {
    return (
      <Page title="Customer Emails">
        <Banner tone="critical" title="Error loading conversations">
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
      subtitle={`${total} total conversation${total !== 1 ? 's' : ''}`}
      primaryAction={{
        content: 'New Email',
        onAction: () => setComposerOpen(true)
      }}
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
            {conversations.length === 0 && !loading ? (
              <Box padding="800">
                <EmptyState
                  heading="No conversations found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Customer email conversations will appear here when received.</p>
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
                      Showing {conversations.length} of {total} conversation{total !== 1 ? 's' : ''}
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

      {/* Thread View Modal */}
      <EmailThreadView
        conversationId={selectedConversationId}
        open={threadViewOpen}
        onClose={handleThreadViewClose}
      />

      {/* New Email Composer */}
      <EmailComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSent={() => {
          setComposerOpen(false);
          fetchEmails();
          fetchStats();
        }}
      />
    </Page>
  );
}
