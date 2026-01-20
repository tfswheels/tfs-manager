import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  DataTable,
  Button,
  Modal,
  TextField,
  Select,
  Banner,
  Spinner,
  EmptyState,
  Text,
  BlockStack,
  InlineStack,
  Badge
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

const AVAILABLE_VARIABLES = [
  'customer_name',
  'order_number',
  'vehicle_year',
  'vehicle_make',
  'vehicle_model',
  'vehicle_trim',
  'wheel_make',
  'wheel_model',
  'email',
  'phone',
  'tracking_number'
];

export default function EmailTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    subject: '',
    body: '',
    template_type: 'custom',
    category: 'general',
    variables: []
  });

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await axios.get(`${API_URL}/api/email-templates`, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      setTemplates(response.data.templates || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
      setError(err.response?.data?.message || 'Failed to load email templates');
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingTemplate(null);
    setFormData({
      name: '',
      description: '',
      subject: '',
      body: '',
      template_type: 'custom',
      category: 'general',
      variables: []
    });
    setModalOpen(true);
  };

  const openEditModal = async (template) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || '',
      subject: template.subject,
      body: template.body,
      template_type: template.template_type || 'custom',
      category: template.category || 'general',
      variables: typeof template.variables === 'string'
        ? JSON.parse(template.variables)
        : (template.variables || [])
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const endpoint = editingTemplate
        ? `${API_URL}/api/email-templates/${editingTemplate.id}`
        : `${API_URL}/api/email-templates`;

      const method = editingTemplate ? 'put' : 'post';

      await axios[method](endpoint, formData, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      setModalOpen(false);
      fetchTemplates();
    } catch (err) {
      console.error('Error saving template:', err);
      alert(err.response?.data?.message || 'Failed to save email template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template) => {
    if (!confirm(`Are you sure you want to delete "${template.name}"?`)) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/api/email-templates/${template.id}`, {
        params: {
          shop: '2f3d7a-2.myshopify.com'
        }
      });

      fetchTemplates();
    } catch (err) {
      console.error('Error deleting template:', err);
      alert(err.response?.data?.message || 'Failed to delete email template');
    }
  };

  const insertVariable = (variable) => {
    const variablePlaceholder = `{{${variable}}}`;
    setFormData({
      ...formData,
      body: formData.body + variablePlaceholder
    });
  };

  const formatVariables = (template) => {
    try {
      const vars = typeof template.variables === 'string'
        ? JSON.parse(template.variables)
        : (template.variables || []);

      if (vars.length === 0) return '-';

      return (
        <InlineStack gap="100">
          {vars.slice(0, 3).map((v, i) => (
            <Badge key={i} tone="info">{v}</Badge>
          ))}
          {vars.length > 3 && <Badge>+{vars.length - 3}</Badge>}
        </InlineStack>
      );
    } catch {
      return '-';
    }
  };

  const rows = templates.map((template) => [
    <Button plain onClick={() => openEditModal(template)}>
      {template.name}
    </Button>,
    template.description || '-',
    template.template_type || 'custom',
    template.category || 'general',
    formatVariables(template),
    <InlineStack gap="200">
      <Button size="slim" onClick={() => openEditModal(template)}>Edit</Button>
      <Button size="slim" tone="critical" onClick={() => handleDelete(template)}>
        Delete
      </Button>
    </InlineStack>
  ]);

  const headings = ['Name', 'Description', 'Type', 'Category', 'Variables', 'Actions'];

  if (loading && templates.length === 0) {
    return (
      <Page title="Email Templates">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 0' }}>
          <Spinner size="large" />
          <Text variant="bodyMd" as="p" tone="subdued" style={{ marginLeft: '12px' }}>
            Loading templates...
          </Text>
        </div>
      </Page>
    );
  }

  if (error && templates.length === 0) {
    return (
      <Page title="Email Templates">
        <Banner tone="critical" title="Error loading templates">
          <p>{error}</p>
          <div style={{ marginTop: '16px' }}>
            <Button onClick={() => fetchTemplates()}>Retry</Button>
          </div>
        </Banner>
      </Page>
    );
  }

  if (templates.length === 0 && !loading) {
    return (
      <Page
        title="Email Templates"
        primaryAction={{
          content: 'Create Template',
          onAction: openCreateModal
        }}
      >
        <EmptyState
          heading="No email templates found"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>Create your first email template to start sending personalized emails to customers.</p>
          <div style={{ marginTop: '16px' }}>
            <Button primary onClick={openCreateModal}>Create Template</Button>
          </div>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page
      title="Email Templates"
      subtitle={`${templates.length} template${templates.length !== 1 ? 's' : ''}`}
      primaryAction={{
        content: 'Create Template',
        onAction: openCreateModal
      }}
      secondaryActions={[
        {
          content: 'Refresh',
          onAction: fetchTemplates
        }
      ]}
    >
      <Card>
        <DataTable
          columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
          headings={headings}
          rows={rows}
          hoverable
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingTemplate ? 'Edit Email Template' : 'Create Email Template'}
        primaryAction={{
          content: 'Save',
          onAction: handleSave,
          loading: saving
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setModalOpen(false)
          }
        ]}
        large
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Template Name"
              value={formData.name}
              onChange={(value) => setFormData({ ...formData, name: value })}
              placeholder="e.g. Vehicle Info Request"
              autoComplete="off"
              requiredIndicator
            />

            <TextField
              label="Description"
              value={formData.description}
              onChange={(value) => setFormData({ ...formData, description: value })}
              placeholder="Brief description of when to use this template"
              autoComplete="off"
            />

            <InlineStack gap="400">
              <div style={{ flex: 1 }}>
                <Select
                  label="Template Type"
                  options={[
                    { label: 'Custom', value: 'custom' },
                    { label: 'Vehicle Request', value: 'vehicle_request' },
                    { label: 'Incorrect Fitment', value: 'incorrect_fitment' },
                    { label: 'Order Ready', value: 'order_ready' }
                  ]}
                  value={formData.template_type}
                  onChange={(value) => setFormData({ ...formData, template_type: value })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <Select
                  label="Category"
                  options={[
                    { label: 'General', value: 'general' },
                    { label: 'Order Update', value: 'order_update' },
                    { label: 'Customer Service', value: 'customer_service' },
                    { label: 'Vehicle Info', value: 'vehicle_info' }
                  ]}
                  value={formData.category}
                  onChange={(value) => setFormData({ ...formData, category: value })}
                />
              </div>
            </InlineStack>

            <TextField
              label="Email Subject"
              value={formData.subject}
              onChange={(value) => setFormData({ ...formData, subject: value })}
              placeholder="e.g. We need your vehicle information - Order {{order_number}}"
              autoComplete="off"
              requiredIndicator
              helpText="Use {{variable_name}} for dynamic content"
            />

            <div>
              <Text variant="bodyMd" as="p" fontWeight="semibold">Available Variables</Text>
              <Text variant="bodyMd" as="p" tone="subdued">Click to insert into email body</Text>
              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {AVAILABLE_VARIABLES.map((variable) => (
                  <Button
                    key={variable}
                    size="slim"
                    onClick={() => insertVariable(variable)}
                  >
                    {variable}
                  </Button>
                ))}
              </div>
            </div>

            <TextField
              label="Email Body"
              value={formData.body}
              onChange={(value) => setFormData({ ...formData, body: value })}
              placeholder="Enter your email content here. Use {{variable_name}} for dynamic content."
              multiline={10}
              autoComplete="off"
              requiredIndicator
              helpText="HTML formatting will be supported in future updates"
            />

            {formData.body && (
              <div style={{ padding: '16px', background: '#f6f6f7', borderRadius: '8px' }}>
                <Text variant="headingMd" as="h3">Preview</Text>
                <div style={{ marginTop: '12px', whiteSpace: 'pre-wrap' }}>
                  {formData.body}
                </div>
              </div>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
