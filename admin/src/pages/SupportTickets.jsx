import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
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
  Divider,
  Checkbox,
  Popover,
  ActionList,
  Modal,
  TextField,
  Select,
  Avatar,
  Icon
} from '@shopify/polaris';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { decodeHTMLEntities } from '../utils/htmlDecode';
import './SupportTickets.css';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';
const SHOP = '2f3d7a-2.myshopify.com';

export default function SupportTickets() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [allTickets, setAllTickets] = useState([]); // Store unfiltered tickets
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({});
  const [searchQuery, setSearchQuery] = useState('');

  // Bulk actions state
  const [selectedTickets, setSelectedTickets] = useState(new Set());
  const [bulkActionActive, setBulkActionActive] = useState(false);
  const [bulkStatusModal, setBulkStatusModal] = useState(false);
  const [bulkAssignModal, setBulkAssignModal] = useState(false);
  const [bulkCloseModal, setBulkCloseModal] = useState(false);

  // Bulk action form state
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignTo, setBulkAssignTo] = useState('');
  const [bulkNote, setBulkNote] = useState('');

  const tabs = [
    { id: 'all', label: 'All Tickets', status: null, badge: null },
    { id: 'open', label: 'Open', status: 'open', badge: 'open' },
    { id: 'assigned', label: 'Assigned', status: 'assigned', badge: 'assigned' },
    { id: 'in_progress', label: 'In Progress', status: 'in_progress', badge: 'in_progress' },
    { id: 'pending_customer', label: 'Pending Customer', status: 'pending_customer', badge: 'pending_customer' },
    { id: 'resolved', label: 'Resolved', status: 'resolved', badge: 'resolved' },
    { id: 'closed', label: 'Closed', status: 'closed', badge: 'closed' }
  ];

  useEffect(() => {
    fetchTickets();
    fetchStats();
    fetchStaff();
  }, [selectedTab, page]);

  // Filter tickets based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      // No search - show all tickets
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = allTickets.filter(ticket => {
      // Search in ticket number
      if (ticket.ticket_number?.toLowerCase().includes(query)) return true;
      // Search in customer email
      if (ticket.customer_email?.toLowerCase().includes(query)) return true;
      // Search in customer name
      if (ticket.customer_name?.toLowerCase().includes(query)) return true;
      // Search in subject
      if (ticket.subject?.toLowerCase().includes(query)) return true;
      // Search in category
      if (ticket.category?.toLowerCase().includes(query)) return true;
      return false;
    });

    setTickets(filtered);
  }, [searchQuery, allTickets]);

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/tickets/stats/summary`, {
        params: { shop: SHOP }
      });

      setStats(response.data.stats);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchStaff = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/staff`, {
        params: { shop: SHOP }
      });

      setStaff(response.data.staff || []);
    } catch (err) {
      console.error('Error fetching staff:', err);
    }
  };

  const fetchTickets = async () => {
    try {
      setLoading(true);
      setError(null);

      const currentTab = tabs[selectedTab];
      const offset = (page - 1) * 50;

      const params = {
        shop: SHOP,
        limit: 50,
        offset: offset
      };

      if (currentTab.status) {
        params.status = currentTab.status;
      }

      const response = await axios.get(`${API_URL}/api/tickets`, { params });

      const fetchedTickets = response.data.tickets || [];
      setAllTickets(fetchedTickets);
      setTickets(fetchedTickets);
      setTotal(response.data.total || 0);
      setSelectedTickets(new Set()); // Clear selection on new load
    } catch (err) {
      console.error('Error fetching tickets:', err);
      setError(err.response?.data?.error || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tabIndex) => {
    setSelectedTab(tabIndex);
    setPage(1);
  };

  const formatDate = (date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      open: { tone: 'info', label: 'Open' },
      assigned: { tone: 'attention', label: 'Assigned' },
      in_progress: { tone: 'warning', label: 'In Progress' },
      pending_customer: { tone: 'critical', label: 'Pending Customer' },
      resolved: { tone: 'success', label: 'Resolved' },
      closed: { tone: undefined, label: 'Closed' }
    };

    const config = statusConfig[status] || { tone: 'info', label: status };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  };

  const getPriorityBadge = (priority) => {
    const priorityConfig = {
      urgent: { tone: 'critical', label: 'Urgent' },
      high: { tone: 'warning', label: 'High' },
      normal: { tone: 'info', label: 'Normal' },
      low: { tone: undefined, label: 'Low' }
    };

    const config = priorityConfig[priority] || { tone: 'info', label: priority };
    return <Badge tone={config.tone} size="small">{config.label}</Badge>;
  };

  // Bulk selection handlers
  const toggleTicket = (ticketId) => {
    const newSet = new Set(selectedTickets);
    if (newSet.has(ticketId)) {
      newSet.delete(ticketId);
    } else {
      newSet.add(ticketId);
    }
    setSelectedTickets(newSet);
  };

  const toggleAllTickets = () => {
    if (selectedTickets.size === tickets.length) {
      setSelectedTickets(new Set());
    } else {
      setSelectedTickets(new Set(tickets.map(t => t.id)));
    }
  };

  const clearSelection = () => {
    setSelectedTickets(new Set());
  };

  // Bulk actions
  const handleBulkStatusChange = async () => {
    if (!bulkStatus || selectedTickets.size === 0) return;

    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/tickets/bulk/status`, {
        ticketIds: Array.from(selectedTickets),
        status: bulkStatus,
        staffId: 1, // TODO: Get current staff ID
        note: bulkNote || undefined
      });

      setBulkStatusModal(false);
      setBulkStatus('');
      setBulkNote('');
      clearSelection();
      fetchTickets();
      fetchStats();
    } catch (err) {
      console.error('Bulk status change failed:', err);
      setError(err.response?.data?.error || 'Bulk operation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkAssignTo || selectedTickets.size === 0) return;

    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/tickets/bulk/assign`, {
        ticketIds: Array.from(selectedTickets),
        assignToId: bulkAssignTo === 'unassign' ? null : parseInt(bulkAssignTo),
        staffId: 1, // TODO: Get current staff ID
        note: bulkNote || undefined
      });

      setBulkAssignModal(false);
      setBulkAssignTo('');
      setBulkNote('');
      clearSelection();
      fetchTickets();
      fetchStats();
    } catch (err) {
      console.error('Bulk assignment failed:', err);
      setError(err.response?.data?.error || 'Bulk operation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkClose = async () => {
    if (selectedTickets.size === 0) return;

    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/tickets/bulk/close`, {
        ticketIds: Array.from(selectedTickets),
        staffId: 1, // TODO: Get current staff ID
        note: bulkNote || undefined
      });

      setBulkCloseModal(false);
      setBulkNote('');
      clearSelection();
      fetchTickets();
      fetchStats();
    } catch (err) {
      console.error('Bulk close failed:', err);
      setError(err.response?.data?.error || 'Bulk operation failed');
    } finally {
      setLoading(false);
    }
  };

  if (loading && tickets.length === 0) {
    return (
      <Page title="Support Tickets">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 0' }}>
          <Spinner size="large" />
          <Text variant="bodyMd" as="p" tone="subdued" style={{ marginLeft: '12px' }}>
            Loading tickets...
          </Text>
        </div>
      </Page>
    );
  }

  if (error && tickets.length === 0) {
    return (
      <Page title="Support Tickets">
        <Banner tone="critical" title="Error loading tickets">
          <p>{error}</p>
          <div style={{ marginTop: '16px' }}>
            <Button onClick={() => fetchTickets()}>Retry</Button>
          </div>
        </Banner>
      </Page>
    );
  }

  const selectedCount = selectedTickets.size;
  const hasSelection = selectedCount > 0;

  return (
    <Page
      title="Support Tickets"
      subtitle={`${total} total ticket${total !== 1 ? 's' : ''}`}
      primaryAction={{
        content: 'New Ticket',
        onAction: () => navigate('/emails/new')
      }}
      secondaryActions={[
        {
          content: 'Settings',
          onAction: () => navigate('/tickets/settings')
        },
        {
          content: 'Sync Staff',
          onAction: async () => {
            try {
              await axios.post(`${API_URL}/api/staff/sync`, {}, {
                params: { shop: SHOP }
              });
              fetchStaff();
            } catch (err) {
              console.error('Staff sync failed:', err);
            }
          }
        },
        {
          content: 'Refresh',
          onAction: () => {
            fetchTickets();
            fetchStats();
          }
        }
      ]}
    >
      <BlockStack gap="500">
        {/* Search Bar */}
        <Card>
          <Box padding="400">
            <TextField
              placeholder="Search by ticket #, email, name, or subject..."
              value={searchQuery}
              onChange={setSearchQuery}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setSearchQuery('')}
            />
          </Box>
        </Card>

        {/* Stats Cards */}
        <div className="stats-grid">
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p" tone="subdued">Open</Text>
                <Text variant="heading2xl" as="h2">
                  {stats.byStatus?.open?.count || 0}
                </Text>
              </BlockStack>
            </Box>
          </Card>
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p" tone="subdued">In Progress</Text>
                <Text variant="heading2xl" as="h2">
                  {stats.byStatus?.in_progress?.count || 0}
                </Text>
              </BlockStack>
            </Box>
          </Card>
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p" tone="subdued">Resolved</Text>
                <Text variant="heading2xl" as="h2">
                  {stats.byStatus?.resolved?.count || 0}
                </Text>
              </BlockStack>
            </Box>
          </Card>
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p" tone="subdued">Unassigned</Text>
                <Text variant="heading2xl" as="h2">
                  {stats.unassigned || 0}
                </Text>
              </BlockStack>
            </Box>
          </Card>
        </div>

        {/* Bulk Actions Bar */}
        {hasSelection && (
          <Card>
            <Box padding="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Text variant="bodyMd" as="p" fontWeight="semibold">
                    {selectedCount} ticket{selectedCount !== 1 ? 's' : ''} selected
                  </Text>
                  <Button size="slim" onClick={clearSelection}>Clear</Button>
                </InlineStack>
                <InlineStack gap="200">
                  <Popover
                    active={bulkActionActive}
                    activator={
                      <Button onClick={() => setBulkActionActive(!bulkActionActive)}>
                        Bulk Actions
                      </Button>
                    }
                    onClose={() => setBulkActionActive(false)}
                  >
                    <ActionList
                      items={[
                        {
                          content: 'Change Status',
                          onAction: () => {
                            setBulkStatusModal(true);
                            setBulkActionActive(false);
                          }
                        },
                        {
                          content: 'Assign to Staff',
                          onAction: () => {
                            setBulkAssignModal(true);
                            setBulkActionActive(false);
                          }
                        },
                        {
                          content: 'Close Tickets',
                          onAction: () => {
                            setBulkCloseModal(true);
                            setBulkActionActive(false);
                          }
                        }
                      ]}
                    />
                  </Popover>
                </InlineStack>
              </InlineStack>
            </Box>
          </Card>
        )}

        {/* Tickets Table */}
        <Card>
          <Tabs
            tabs={tabs.map((tab) => {
              const count = tab.badge ? (stats.byStatus?.[tab.badge]?.count || 0) : stats.total;
              return {
                id: tab.id,
                content: `${tab.label}${count > 0 ? ` (${count})` : ''}`
              };
            })}
            selected={selectedTab}
            onSelect={handleTabChange}
          >
            {tickets.length === 0 && !loading ? (
              <Box padding="800">
                <EmptyState
                  heading="No tickets found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Support tickets will appear here when customers contact you.</p>
                </EmptyState>
              </Box>
            ) : (
              <>
                <Box padding="0">
                  <div className="ticket-list">
                    {/* Table Header */}
                    <div className="ticket-row ticket-header">
                      <div className="ticket-checkbox">
                        <Checkbox
                          checked={selectedTickets.size === tickets.length && tickets.length > 0}
                          onChange={toggleAllTickets}
                        />
                      </div>
                      <div className="ticket-number">Ticket</div>
                      <div className="ticket-from">From</div>
                      <div className="ticket-subject">Subject</div>
                      <div className="ticket-status">Status</div>
                      <div className="ticket-priority">Priority</div>
                      <div className="ticket-assigned">Assigned To</div>
                      <div className="ticket-date">Last Activity</div>
                    </div>

                    {/* Ticket Rows */}
                    {tickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className={`ticket-row ${selectedTickets.has(ticket.id) ? 'selected' : ''} ${ticket.unread_count > 0 ? 'unread' : ''}`}
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                      >
                        <div className="ticket-checkbox" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedTickets.has(ticket.id)}
                            onChange={() => toggleTicket(ticket.id)}
                          />
                        </div>
                        <div className="ticket-number">
                          <Text variant="bodyMd" as="span" fontWeight="medium">
                            {ticket.ticket_number}
                          </Text>
                          <InlineStack gap="100" wrap={false}>
                            {ticket.message_count > 0 && (
                              <Badge tone="info" size="small">
                                {ticket.message_count} {ticket.message_count === 1 ? 'message' : 'messages'}
                              </Badge>
                            )}
                            {ticket.unread_count > 0 && (
                              <Badge tone="attention" size="small">{ticket.unread_count} new</Badge>
                            )}
                          </InlineStack>
                        </div>
                        <div className="ticket-from">
                          <Text variant="bodyMd" as="span" fontWeight={ticket.unread_count > 0 ? 'semibold' : 'regular'}>
                            {decodeHTMLEntities(ticket.customer_name) || decodeHTMLEntities(ticket.customer_email)}
                          </Text>
                        </div>
                        <div className="ticket-subject">
                          <Text variant="bodyMd" as="span" fontWeight={ticket.unread_count > 0 ? 'semibold' : 'regular'}>
                            {decodeHTMLEntities(ticket.subject) || '(No Subject)'}
                          </Text>
                          {ticket.category && (
                            <Text variant="bodySm" as="p" tone="subdued">
                              {decodeHTMLEntities(ticket.category)}
                            </Text>
                          )}
                        </div>
                        <div className="ticket-status">
                          {getStatusBadge(ticket.status)}
                        </div>
                        <div className="ticket-priority">
                          {getPriorityBadge(ticket.priority || 'normal')}
                        </div>
                        <div className="ticket-assigned">
                          {ticket.assigned_to_name ? (
                            <InlineStack gap="200" blockAlign="center">
                              {ticket.assigned_to_avatar && (
                                <Avatar
                                  size="small"
                                  source={ticket.assigned_to_avatar}
                                  name={decodeHTMLEntities(ticket.assigned_to_name)}
                                />
                              )}
                              <Text variant="bodySm" as="span">
                                {decodeHTMLEntities(ticket.assigned_to_name)}
                              </Text>
                            </InlineStack>
                          ) : (
                            <Text variant="bodySm" as="span" tone="subdued">
                              Unassigned
                            </Text>
                          )}
                        </div>
                        <div className="ticket-date">
                          <Text variant="bodySm" as="span" tone="subdued">
                            {formatDate(ticket.last_message_at)}
                          </Text>
                        </div>
                      </div>
                    ))}
                  </div>
                </Box>

                <Divider />

                {/* Pagination */}
                <Box padding="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Showing {tickets.length} of {total} ticket{total !== 1 ? 's' : ''}
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
                        disabled={tickets.length < 50 || loading}
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

      {/* Bulk Status Change Modal */}
      <Modal
        open={bulkStatusModal}
        onClose={() => setBulkStatusModal(false)}
        title={`Change status for ${selectedCount} ticket${selectedCount !== 1 ? 's' : ''}`}
        primaryAction={{
          content: 'Update Status',
          onAction: handleBulkStatusChange,
          disabled: !bulkStatus
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setBulkStatusModal(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select
              label="New Status"
              options={[
                { label: 'Select status...', value: '' },
                { label: 'Open', value: 'open' },
                { label: 'Assigned', value: 'assigned' },
                { label: 'In Progress', value: 'in_progress' },
                { label: 'Pending Customer', value: 'pending_customer' },
                { label: 'Resolved', value: 'resolved' },
                { label: 'Closed', value: 'closed' }
              ]}
              value={bulkStatus}
              onChange={setBulkStatus}
            />
            <TextField
              label="Note (optional)"
              value={bulkNote}
              onChange={setBulkNote}
              multiline={3}
              placeholder="Add a note about this change..."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Bulk Assignment Modal */}
      <Modal
        open={bulkAssignModal}
        onClose={() => setBulkAssignModal(false)}
        title={`Assign ${selectedCount} ticket${selectedCount !== 1 ? 's' : ''}`}
        primaryAction={{
          content: 'Assign Tickets',
          onAction: handleBulkAssign,
          disabled: !bulkAssignTo
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setBulkAssignModal(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select
              label="Assign to Staff"
              options={[
                { label: 'Select staff member...', value: '' },
                { label: 'Unassign', value: 'unassign' },
                ...staff.map(s => ({ label: s.full_name, value: s.id.toString() }))
              ]}
              value={bulkAssignTo}
              onChange={setBulkAssignTo}
            />
            <TextField
              label="Note (optional)"
              value={bulkNote}
              onChange={setBulkNote}
              multiline={3}
              placeholder="Add a note about this assignment..."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Bulk Close Modal */}
      <Modal
        open={bulkCloseModal}
        onClose={() => setBulkCloseModal(false)}
        title={`Close ${selectedCount} ticket${selectedCount !== 1 ? 's' : ''}`}
        primaryAction={{
          content: 'Close Tickets',
          onAction: handleBulkClose,
          destructive: true
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setBulkCloseModal(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodyMd" as="p">
              Are you sure you want to close {selectedCount} ticket{selectedCount !== 1 ? 's' : ''}?
            </Text>
            <TextField
              label="Note (optional)"
              value={bulkNote}
              onChange={setBulkNote}
              multiline={3}
              placeholder="Add a note about closing these tickets..."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
