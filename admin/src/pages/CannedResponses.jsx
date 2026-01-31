import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Card,
  Button,
  TextField,
  Select,
  Modal,
  Badge,
  EmptyState,
  Spinner,
  Banner,
  Frame,
  Toast,
  DataTable,
  ButtonGroup,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Divider,
  Icon,
  Popover,
  ActionList,
} from '@shopify/polaris';
import { DeleteMinor, EditMinor, DuplicateMinor } from '@shopify/polaris-icons';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const SHOP_ID = 1; // Default shop ID

export default function CannedResponses() {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingResponse, setEditingResponse] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activePopover, setActivePopover] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    shortcut: '',
    category: '',
    body_html: '',
    body_text: '',
  });

  // Toast state
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastError, setToastError] = useState(false);

  useEffect(() => {
    fetchResponses();
  }, [categoryFilter]);

  const fetchResponses = async () => {
    try {
      setLoading(true);
      const params = categoryFilter ? { category: categoryFilter } : {};
      const response = await axios.get(`${API_URL}/api/canned-responses/${SHOP_ID}`, { params });

      if (response.data.success) {
        setResponses(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch canned responses:', error);
      showToast('Failed to load canned responses', true);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message, isError = false) => {
    setToastMessage(message);
    setToastError(isError);
    setToastActive(true);
  };

  const toggleToast = useCallback(() => setToastActive((active) => !active), []);

  const handleCreate = () => {
    setEditingResponse(null);
    setFormData({
      title: '',
      shortcut: '',
      category: '',
      body_html: '',
      body_text: '',
    });
    setShowModal(true);
  };

  const handleEdit = (response) => {
    setEditingResponse(response);
    setFormData({
      title: response.title || '',
      shortcut: response.shortcut || '',
      category: response.category || '',
      body_html: response.body_html || '',
      body_text: response.body_text || '',
    });
    setShowModal(true);
    setActivePopover(null);
  };

  const handleDuplicate = (response) => {
    setEditingResponse(null);
    setFormData({
      title: `${response.title} (Copy)`,
      shortcut: response.shortcut ? `${response.shortcut}-copy` : '',
      category: response.category || '',
      body_html: response.body_html || '',
      body_text: response.body_text || '',
    });
    setShowModal(true);
    setActivePopover(null);
  };

  const handleDelete = async (response) => {
    if (!confirm(`Are you sure you want to delete "${response.title}"?`)) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/api/canned-responses/${response.id}`);
      showToast('Canned response deleted successfully');
      fetchResponses();
    } catch (error) {
      console.error('Delete failed:', error);
      showToast('Failed to delete canned response', true);
    }
    setActivePopover(null);
  };

  const handleSave = async () => {
    // Validation
    if (!formData.title.trim() || !formData.body_html.trim()) {
      showToast('Title and body are required', true);
      return;
    }

    try {
      if (editingResponse) {
        // Update existing
        await axios.put(`${API_URL}/api/canned-responses/${editingResponse.id}`, formData);
        showToast('Canned response updated successfully');
      } else {
        // Create new
        await axios.post(`${API_URL}/api/canned-responses/${SHOP_ID}`, formData);
        showToast('Canned response created successfully');
      }

      setShowModal(false);
      fetchResponses();
    } catch (error) {
      console.error('Save failed:', error);
      showToast('Failed to save canned response', true);
    }
  };

  // Filter responses based on search
  const filteredResponses = responses.filter(response => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      response.title?.toLowerCase().includes(query) ||
      response.shortcut?.toLowerCase().includes(query) ||
      response.category?.toLowerCase().includes(query) ||
      response.body_text?.toLowerCase().includes(query)
    );
  });

  // Category options
  const categories = ['Orders', 'Shipping', 'Product Questions', 'Returns', 'Technical', 'General'];
  const categoryOptions = [
    { label: 'All Categories', value: '' },
    ...categories.map(cat => ({ label: cat, value: cat })),
  ];

  const toastMarkup = toastActive ? (
    <Toast
      content={toastMessage}
      onDismiss={toggleToast}
      error={toastError}
      duration={3000}
    />
  ) : null;

  return (
    <Frame>
      <Page
        title="Canned Responses"
        subtitle="Quick reply templates for common customer inquiries"
        primaryAction={{
          content: 'Create Template',
          onAction: handleCreate,
        }}
      >
        <BlockStack gap="400">
          {/* Info Banner */}
          <Banner>
            <p>
              Create templates with placeholders like <code>{'{{customer_name}}'}</code>, <code>{'{{ticket_number}}'}</code>, and <code>{'{{order_number}}'}</code>.
              Use shortcuts (e.g., <code>/refund</code>) to quickly insert templates when replying to tickets.
            </p>
          </Banner>

          {/* Search and Filter */}
          <Card>
            <Box padding="400">
              <InlineStack gap="400" align="space-between" blockAlign="center">
                <Box width="60%">
                  <TextField
                    placeholder="Search templates..."
                    value={searchQuery}
                    onChange={setSearchQuery}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setSearchQuery('')}
                  />
                </Box>
                <Box width="35%">
                  <Select
                    label="Filter by category"
                    labelHidden
                    options={categoryOptions}
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                  />
                </Box>
              </InlineStack>
            </Box>
          </Card>

          {/* Templates List */}
          {loading ? (
            <Card>
              <Box padding="400" paddingBlockStart="800" paddingBlockEnd="800">
                <InlineStack align="center">
                  <Spinner size="large" />
                </InlineStack>
              </Box>
            </Card>
          ) : filteredResponses.length === 0 ? (
            <Card>
              <EmptyState
                heading={searchQuery ? 'No templates found' : 'No canned responses yet'}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: 'Create Template',
                  onAction: handleCreate,
                }}
              >
                <p>
                  {searchQuery
                    ? 'Try adjusting your search or filter'
                    : 'Create your first quick reply template to save time responding to common questions'}
                </p>
              </EmptyState>
            </Card>
          ) : (
            <BlockStack gap="300">
              {filteredResponses.map((response) => (
                <Card key={response.id}>
                  <Box padding="400">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="200">
                        <InlineStack gap="300" blockAlign="center">
                          <Text variant="headingMd" as="h3">
                            {response.title}
                          </Text>
                          {response.category && (
                            <Badge tone="info">{response.category}</Badge>
                          )}
                          {response.shortcut && (
                            <Badge>
                              <code>{response.shortcut}</code>
                            </Badge>
                          )}
                          {response.usage_count > 0 && (
                            <Badge tone="success">
                              Used {response.usage_count}x
                            </Badge>
                          )}
                        </InlineStack>

                        <Box maxWidth="800px">
                          <Text variant="bodyMd" as="p" tone="subdued">
                            {response.body_text?.substring(0, 150)}
                            {response.body_text?.length > 150 ? '...' : ''}
                          </Text>
                        </Box>

                        {response.created_by_name && (
                          <Text variant="bodySm" as="p" tone="subdued">
                            Created by {response.created_by_name}
                          </Text>
                        )}
                      </BlockStack>

                      <Popover
                        active={activePopover === response.id}
                        activator={
                          <Button
                            onClick={() => setActivePopover(activePopover === response.id ? null : response.id)}
                            disclosure
                          >
                            Actions
                          </Button>
                        }
                        onClose={() => setActivePopover(null)}
                      >
                        <ActionList
                          items={[
                            {
                              content: 'Edit',
                              icon: EditMinor,
                              onAction: () => handleEdit(response),
                            },
                            {
                              content: 'Duplicate',
                              icon: DuplicateMinor,
                              onAction: () => handleDuplicate(response),
                            },
                            {
                              content: 'Delete',
                              icon: DeleteMinor,
                              destructive: true,
                              onAction: () => handleDelete(response),
                            },
                          ]}
                        />
                      </Popover>
                    </InlineStack>
                  </Box>
                </Card>
              ))}
            </BlockStack>
          )}

          {/* Stats Summary */}
          {!loading && filteredResponses.length > 0 && (
            <Card>
              <Box padding="400">
                <InlineStack gap="600">
                  <Text variant="bodyMd" as="p">
                    <strong>{filteredResponses.length}</strong> templates
                  </Text>
                  <Text variant="bodyMd" as="p">
                    <strong>{filteredResponses.filter(r => r.shortcut).length}</strong> with shortcuts
                  </Text>
                  <Text variant="bodyMd" as="p">
                    <strong>{filteredResponses.reduce((sum, r) => sum + (r.usage_count || 0), 0)}</strong> total uses
                  </Text>
                </InlineStack>
              </Box>
            </Card>
          )}
        </BlockStack>

        {/* Create/Edit Modal */}
        <Modal
          open={showModal}
          onClose={() => setShowModal(false)}
          title={editingResponse ? 'Edit Template' : 'Create Template'}
          primaryAction={{
            content: editingResponse ? 'Update' : 'Create',
            onAction: handleSave,
          }}
          secondaryActions={[
            {
              content: 'Cancel',
              onAction: () => setShowModal(false),
            },
          ]}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Template Title"
                value={formData.title}
                onChange={(value) => setFormData({ ...formData, title: value })}
                placeholder="e.g., Refund Process"
                autoComplete="off"
                requiredIndicator
              />

              <TextField
                label="Shortcut (optional)"
                value={formData.shortcut}
                onChange={(value) => setFormData({ ...formData, shortcut: value })}
                placeholder="e.g., /refund"
                autoComplete="off"
                helpText="Type this shortcut in ticket replies to insert this template"
                prefix="/"
              />

              <Select
                label="Category"
                options={[
                  { label: 'Select category', value: '' },
                  ...categories.map(cat => ({ label: cat, value: cat })),
                ]}
                value={formData.category}
                onChange={(value) => setFormData({ ...formData, category: value })}
              />

              <TextField
                label="Template Content"
                value={formData.body_html}
                onChange={(value) => {
                  setFormData({
                    ...formData,
                    body_html: value,
                    body_text: value.replace(/<[^>]*>/g, ''), // Strip HTML for body_text
                  });
                }}
                multiline={10}
                placeholder="Enter your template here..."
                helpText="Use placeholders: {{customer_name}}, {{customer_first_name}}, {{ticket_number}}, {{subject}}, {{order_number}}, {{vehicle_full}}"
                autoComplete="off"
                requiredIndicator
              />

              <Banner tone="info">
                <p><strong>Available Placeholders:</strong></p>
                <ul>
                  <li><code>{'{{customer_name}}'}</code> - Full customer name</li>
                  <li><code>{'{{customer_first_name}}'}</code> - First name only</li>
                  <li><code>{'{{ticket_number}}'}</code> - Ticket number (e.g., TFS-1-00042)</li>
                  <li><code>{'{{subject}}'}</code> - Email subject</li>
                  <li><code>{'{{order_number}}'}</code> - Order number</li>
                  <li><code>{'{{vehicle_full}}'}</code> - Full vehicle info</li>
                </ul>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </Page>

      {toastMarkup}
    </Frame>
  );
}
