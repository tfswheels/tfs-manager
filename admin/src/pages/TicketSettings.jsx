import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Card,
  Tabs,
  FormLayout,
  TextField,
  Select,
  Checkbox,
  Button,
  Banner,
  TextContainer,
  Toast,
  Frame,
  SkeletonBodyText,
  SkeletonDisplayText,
  Layout,
  ButtonGroup,
  Badge,
  InlineGrid,
  BlockStack,
  Box,
  Text,
  Divider,
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const SHOP_ID = 1; // Default shop ID

export default function TicketSettings() {
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [businessHours, setBusinessHours] = useState([]);
  const [footerSettings, setFooterSettings] = useState(null);
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastError, setToastError] = useState(false);

  // Fetch all settings on mount
  useEffect(() => {
    fetchAllSettings();
  }, []);

  const fetchAllSettings = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/settings/${SHOP_ID}`);

      if (response.data.success) {
        setSettings(response.data.data.ticketSettings);
        setBusinessHours(response.data.data.businessHours);
        setFooterSettings(response.data.data.emailFooter);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      showToast('Failed to load settings', true);
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

  const tabs = [
    {
      id: 'general',
      content: 'General & Automation',
      panelID: 'general-panel',
    },
    {
      id: 'business-hours',
      content: 'Business Hours',
      panelID: 'business-hours-panel',
    },
    {
      id: 'templates',
      content: 'Email Templates',
      panelID: 'templates-panel',
    },
    {
      id: 'footer',
      content: 'Email Footer',
      panelID: 'footer-panel',
    },
    {
      id: 'sla',
      content: 'SLA & Escalation',
      panelID: 'sla-panel',
    },
    {
      id: 'assignment',
      content: 'Assignment Rules',
      panelID: 'assignment-panel',
    },
    {
      id: 'notifications',
      content: 'Notifications',
      panelID: 'notifications-panel',
    },
    {
      id: 'tags',
      content: 'Tags & Categories',
      panelID: 'tags-panel',
    },
    {
      id: 'canned',
      content: 'Canned Responses',
      panelID: 'canned-panel',
    },
  ];

  const handleTabChange = useCallback((selectedTabIndex) => setSelected(selectedTabIndex), []);

  // Save handlers for each section
  const saveTicketSettings = async (updates) => {
    try {
      setSaving(true);
      const response = await axios.put(`${API_URL}/api/settings/${SHOP_ID}/ticket`, updates);

      if (response.data.success) {
        setSettings(response.data.data);
        showToast('Settings saved successfully!');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      showToast('Failed to save settings', true);
    } finally {
      setSaving(false);
    }
  };

  const saveBusinessHours = async (hours) => {
    try {
      setSaving(true);
      const response = await axios.put(`${API_URL}/api/settings/${SHOP_ID}/business-hours`, { hours });

      if (response.data.success) {
        setBusinessHours(response.data.data);
        showToast('Business hours saved successfully!');
      }
    } catch (error) {
      console.error('Failed to save business hours:', error);
      showToast('Failed to save business hours', true);
    } finally {
      setSaving(false);
    }
  };

  const saveFooterSettings = async (updates) => {
    try {
      setSaving(true);
      const response = await axios.put(`${API_URL}/api/settings/${SHOP_ID}/footer`, updates);

      if (response.data.success) {
        setFooterSettings(response.data.data);
        showToast('Email footer settings saved successfully!');
      }
    } catch (error) {
      console.error('Failed to save footer settings:', error);
      showToast('Failed to save footer settings', true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Page title="Ticket Settings" narrowWidth>
        <Card>
          <SkeletonDisplayText size="small" />
          <SkeletonBodyText lines={10} />
        </Card>
      </Page>
    );
  }

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
        title="Ticket Settings"
        subtitle="Configure your support ticketing system"
        narrowWidth
      >
        <Card>
          <Tabs tabs={tabs} selected={selected} onSelect={handleTabChange}>
            <Box padding="400">
              {selected === 0 && (
                <GeneralAutomationSettings
                  settings={settings}
                  onSave={saveTicketSettings}
                  saving={saving}
                />
              )}
              {selected === 1 && (
                <BusinessHoursSettings
                  businessHours={businessHours}
                  onSave={saveBusinessHours}
                  saving={saving}
                />
              )}
              {selected === 2 && (
                <EmailTemplatesSettings
                  settings={settings}
                  onSave={saveTicketSettings}
                  saving={saving}
                />
              )}
              {selected === 3 && (
                <EmailFooterSettings
                  footerSettings={footerSettings}
                  onSave={saveFooterSettings}
                  saving={saving}
                />
              )}
              {selected === 4 && (
                <SLAEscalationSettings
                  settings={settings}
                  onSave={saveTicketSettings}
                  saving={saving}
                />
              )}
              {selected === 5 && (
                <AssignmentSettings
                  settings={settings}
                  onSave={saveTicketSettings}
                  saving={saving}
                />
              )}
              {selected === 6 && (
                <NotificationSettings
                  settings={settings}
                  onSave={saveTicketSettings}
                  saving={saving}
                />
              )}
              {selected === 7 && (
                <TagsCategoriesSettings
                  settings={settings}
                  onSave={saveTicketSettings}
                  saving={saving}
                />
              )}
              {selected === 8 && (
                <CannedResponsesSettings />
              )}
            </Box>
          </Tabs>
        </Card>
      </Page>
      {toastMarkup}
    </Frame>
  );
}

// ============================================================================
// SECTION 1: GENERAL & AUTOMATION
// ============================================================================

function GeneralAutomationSettings({ settings, onSave, saving }) {
  const [formData, setFormData] = useState({
    auto_response_enabled: settings?.auto_response_enabled || false,
    auto_response_delay_minutes: settings?.auto_response_delay_minutes || 5,
    pending_reminder_enabled: settings?.pending_reminder_enabled || false,
    pending_reminder_max_count: settings?.pending_reminder_max_count || 3,
    auto_close_enabled: settings?.auto_close_enabled || false,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        auto_response_enabled: settings.auto_response_enabled,
        auto_response_delay_minutes: settings.auto_response_delay_minutes,
        pending_reminder_enabled: settings.pending_reminder_enabled,
        pending_reminder_max_count: settings.pending_reminder_max_count,
        auto_close_enabled: settings.auto_close_enabled,
      });
    }
  }, [settings]);

  const handleSubmit = () => {
    onSave(formData);
  };

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <p>Configure automated responses and reminder settings for customer tickets.</p>
      </Banner>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Auto-Response Settings</Text>

          <Checkbox
            label="Enable automatic responses"
            checked={formData.auto_response_enabled}
            onChange={(value) => setFormData({ ...formData, auto_response_enabled: value })}
            helpText="Send automatic confirmation emails when customers create tickets"
          />

          {formData.auto_response_enabled && (
            <TextField
              label="Response delay (minutes)"
              type="number"
              value={String(formData.auto_response_delay_minutes)}
              onChange={(value) => setFormData({ ...formData, auto_response_delay_minutes: parseInt(value) || 0 })}
              helpText="Wait time before sending auto-response (prevents duplicate if staff replies quickly)"
              min={0}
              max={60}
            />
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Pending Customer Reminders</Text>

          <Checkbox
            label="Enable pending customer reminders"
            checked={formData.pending_reminder_enabled}
            onChange={(value) => setFormData({ ...formData, pending_reminder_enabled: value })}
            helpText="Send reminder emails to customers who haven't responded (runs daily at 10am EST)"
          />

          {formData.pending_reminder_enabled && (
            <TextField
              label="Maximum reminders before auto-close"
              type="number"
              value={String(formData.pending_reminder_max_count)}
              onChange={(value) => setFormData({ ...formData, pending_reminder_max_count: parseInt(value) || 1 })}
              helpText="Number of reminders to send before auto-closing ticket (1-5 recommended)"
              min={1}
              max={10}
            />
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Auto-Close Settings</Text>

          <Checkbox
            label="Enable automatic ticket closing"
            checked={formData.auto_close_enabled}
            onChange={(value) => setFormData({ ...formData, auto_close_enabled: value })}
            helpText="Automatically close tickets after maximum reminders sent with no customer response"
          />
        </BlockStack>
      </Card>

      <Box>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={saving}
        >
          Save Settings
        </Button>
      </Box>
    </BlockStack>
  );
}

// ============================================================================
// SECTION 2: BUSINESS HOURS
// ============================================================================

function BusinessHoursSettings({ businessHours, onSave, saving }) {
  const [hours, setHours] = useState([]);

  useEffect(() => {
    if (businessHours && businessHours.length > 0) {
      setHours(businessHours);
    }
  }, [businessHours]);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const handleDayToggle = (dayIndex, isOpen) => {
    const newHours = [...hours];
    newHours[dayIndex] = {
      ...newHours[dayIndex],
      is_open: isOpen ? 1 : 0,
    };
    setHours(newHours);
  };

  const handleTimeChange = (dayIndex, field, value) => {
    const newHours = [...hours];
    newHours[dayIndex] = {
      ...newHours[dayIndex],
      [field]: value,
    };
    setHours(newHours);
  };

  const handleSubmit = () => {
    onSave(hours);
  };

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <p>Set your business hours to customize auto-response messages during and outside business hours.</p>
      </Banner>

      {hours.map((day, index) => (
        <Card key={day.id || index}>
          <BlockStack gap="300">
            <Checkbox
              label={<Text variant="headingMd">{dayNames[day.day_of_week]}</Text>}
              checked={day.is_open === 1}
              onChange={(value) => handleDayToggle(index, value)}
            />

            {day.is_open === 1 && (
              <InlineGrid columns={2} gap="400">
                <TextField
                  label="Open time"
                  type="time"
                  value={day.open_time || '09:00:00'}
                  onChange={(value) => handleTimeChange(index, 'open_time', value)}
                />
                <TextField
                  label="Close time"
                  type="time"
                  value={day.close_time || '18:00:00'}
                  onChange={(value) => handleTimeChange(index, 'close_time', value)}
                />
              </InlineGrid>
            )}
          </BlockStack>
        </Card>
      ))}

      <Box>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={saving}
        >
          Save Business Hours
        </Button>
      </Box>
    </BlockStack>
  );
}

// ============================================================================
// SECTION 3: EMAIL TEMPLATES
// ============================================================================

function EmailTemplatesSettings({ settings, onSave, saving }) {
  const [formData, setFormData] = useState({
    auto_response_business_hours: '',
    auto_response_after_hours: '',
    pending_reminder_template_1: '',
    pending_reminder_template_2: '',
    pending_reminder_template_3: '',
    auto_close_template: '',
    ticket_closed_confirmation_template: '',
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        auto_response_business_hours: settings.auto_response_business_hours || '',
        auto_response_after_hours: settings.auto_response_after_hours || '',
        pending_reminder_template_1: settings.pending_reminder_template_1 || '',
        pending_reminder_template_2: settings.pending_reminder_template_2 || '',
        pending_reminder_template_3: settings.pending_reminder_template_3 || '',
        auto_close_template: settings.auto_close_template || '',
        ticket_closed_confirmation_template: settings.ticket_closed_confirmation_template || '',
      });
    }
  }, [settings]);

  const handleSubmit = () => {
    onSave(formData);
  };

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <p>
          Customize email templates with placeholders: <code>{'{{customer_name}}'}</code>, <code>{'{{customer_first_name}}'}</code>, <code>{'{{ticket_number}}'}</code>, <code>{'{{subject}}'}</code>, <code>{'{{order_number}}'}</code>
        </p>
      </Banner>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Auto-Response (Business Hours)</Text>
          <TextField
            label="Template"
            value={formData.auto_response_business_hours}
            onChange={(value) => setFormData({ ...formData, auto_response_business_hours: value })}
            multiline={8}
            helpText="Sent when customer creates ticket during business hours"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Auto-Response (After Hours)</Text>
          <TextField
            label="Template"
            value={formData.auto_response_after_hours}
            onChange={(value) => setFormData({ ...formData, auto_response_after_hours: value })}
            multiline={8}
            helpText="Sent when customer creates ticket outside business hours"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Pending Reminder #1 (Day 1)</Text>
          <TextField
            label="Template"
            value={formData.pending_reminder_template_1}
            onChange={(value) => setFormData({ ...formData, pending_reminder_template_1: value })}
            multiline={6}
            helpText="First reminder after 24 hours of no customer response"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Pending Reminder #2 (Day 2)</Text>
          <TextField
            label="Template"
            value={formData.pending_reminder_template_2}
            onChange={(value) => setFormData({ ...formData, pending_reminder_template_2: value })}
            multiline={6}
            helpText="Second reminder after another 24 hours"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Pending Reminder #3 (Day 3)</Text>
          <TextField
            label="Template"
            value={formData.pending_reminder_template_3}
            onChange={(value) => setFormData({ ...formData, pending_reminder_template_3: value })}
            multiline={6}
            helpText="Final reminder before auto-close"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Auto-Close Email</Text>
          <TextField
            label="Template"
            value={formData.auto_close_template}
            onChange={(value) => setFormData({ ...formData, auto_close_template: value })}
            multiline={6}
            helpText="Sent when ticket is automatically closed after max reminders"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Ticket Closed Confirmation</Text>
          <TextField
            label="Template"
            value={formData.ticket_closed_confirmation_template}
            onChange={(value) => setFormData({ ...formData, ticket_closed_confirmation_template: value })}
            multiline={6}
            helpText="Sent when customer closes ticket via email link"
          />
        </BlockStack>
      </Card>

      <Box>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={saving}
        >
          Save Email Templates
        </Button>
      </Box>
    </BlockStack>
  );
}

// ============================================================================
// SECTION 4: EMAIL FOOTER
// ============================================================================

function EmailFooterSettings({ footerSettings, onSave, saving }) {
  const [formData, setFormData] = useState({
    company_name: '',
    company_address: '',
    company_phone: '',
    company_email: '',
    logo_url: '',
    show_social_links: false,
    facebook_url: '',
    twitter_url: '',
    instagram_url: '',
    show_close_ticket_link: false,
  });

  useEffect(() => {
    if (footerSettings) {
      setFormData({
        company_name: footerSettings.company_name || '',
        company_address: footerSettings.company_address || '',
        company_phone: footerSettings.company_phone || '',
        company_email: footerSettings.company_email || '',
        logo_url: footerSettings.logo_url || '',
        show_social_links: footerSettings.show_social_links || false,
        facebook_url: footerSettings.facebook_url || '',
        twitter_url: footerSettings.twitter_url || '',
        instagram_url: footerSettings.instagram_url || '',
        show_close_ticket_link: footerSettings.show_close_ticket_link || false,
      });
    }
  }, [footerSettings]);

  const handleSubmit = () => {
    onSave(formData);
  };

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <p>Customize the footer that appears in all outgoing ticket emails.</p>
      </Banner>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Company Information</Text>

          <TextField
            label="Company name"
            value={formData.company_name}
            onChange={(value) => setFormData({ ...formData, company_name: value })}
          />

          <TextField
            label="Logo URL"
            value={formData.logo_url}
            onChange={(value) => setFormData({ ...formData, logo_url: value })}
            helpText="URL to your company logo (recommended: 200x60px)"
          />

          <TextField
            label="Email address"
            type="email"
            value={formData.company_email}
            onChange={(value) => setFormData({ ...formData, company_email: value })}
          />

          <TextField
            label="Phone number"
            type="tel"
            value={formData.company_phone}
            onChange={(value) => setFormData({ ...formData, company_phone: value })}
          />

          <TextField
            label="Address"
            value={formData.company_address}
            onChange={(value) => setFormData({ ...formData, company_address: value })}
            multiline={3}
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Checkbox
            label="Show social media links"
            checked={formData.show_social_links}
            onChange={(value) => setFormData({ ...formData, show_social_links: value })}
          />

          {formData.show_social_links && (
            <BlockStack gap="300">
              <TextField
                label="Facebook URL"
                value={formData.facebook_url}
                onChange={(value) => setFormData({ ...formData, facebook_url: value })}
                placeholder="https://facebook.com/yourcompany"
              />

              <TextField
                label="Twitter URL"
                value={formData.twitter_url}
                onChange={(value) => setFormData({ ...formData, twitter_url: value })}
                placeholder="https://twitter.com/yourcompany"
              />

              <TextField
                label="Instagram URL"
                value={formData.instagram_url}
                onChange={(value) => setFormData({ ...formData, instagram_url: value })}
                placeholder="https://instagram.com/yourcompany"
              />
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Checkbox
            label='Show "Close Ticket" link in footer'
            checked={formData.show_close_ticket_link}
            onChange={(value) => setFormData({ ...formData, show_close_ticket_link: value })}
            helpText="Allow customers to close tickets directly from email"
          />
        </BlockStack>
      </Card>

      <Box>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={saving}
        >
          Save Footer Settings
        </Button>
      </Box>
    </BlockStack>
  );
}

// ============================================================================
// SECTION 5: SLA & ESCALATION
// ============================================================================

function SLAEscalationSettings({ settings, onSave, saving }) {
  const [formData, setFormData] = useState({
    sla_first_response_hours: 4,
    sla_resolution_hours: 48,
    escalation_enabled: false,
    escalation_hours: 24,
    escalation_notify_all_staff: false,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        sla_first_response_hours: settings.sla_first_response_hours || 4,
        sla_resolution_hours: settings.sla_resolution_hours || 48,
        escalation_enabled: settings.escalation_enabled || false,
        escalation_hours: settings.escalation_hours || 24,
        escalation_notify_all_staff: settings.escalation_notify_all_staff || false,
      });
    }
  }, [settings]);

  const handleSubmit = () => {
    onSave(formData);
  };

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <p>Set SLA targets and automatic escalation rules for tickets.</p>
      </Banner>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">SLA Targets</Text>

          <TextField
            label="First response time (hours)"
            type="number"
            value={String(formData.sla_first_response_hours)}
            onChange={(value) => setFormData({ ...formData, sla_first_response_hours: parseInt(value) || 1 })}
            helpText="Target time for first staff response to new ticket"
            min={1}
            max={168}
            suffix="hours"
          />

          <TextField
            label="Resolution time (hours)"
            type="number"
            value={String(formData.sla_resolution_hours)}
            onChange={(value) => setFormData({ ...formData, sla_resolution_hours: parseInt(value) || 1 })}
            helpText="Target time to resolve/close ticket"
            min={1}
            max={720}
            suffix="hours"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Escalation Settings</Text>

          <Checkbox
            label="Enable automatic escalation"
            checked={formData.escalation_enabled}
            onChange={(value) => setFormData({ ...formData, escalation_enabled: value })}
            helpText="Escalate tickets that haven't been updated in specified time (runs every 15 minutes)"
          />

          {formData.escalation_enabled && (
            <>
              <TextField
                label="Escalate after (hours)"
                type="number"
                value={String(formData.escalation_hours)}
                onChange={(value) => setFormData({ ...formData, escalation_hours: parseInt(value) || 1 })}
                helpText="Time of inactivity before ticket is escalated"
                min={1}
                max={168}
                suffix="hours"
              />

              <Checkbox
                label="Notify all staff on escalation"
                checked={formData.escalation_notify_all_staff}
                onChange={(value) => setFormData({ ...formData, escalation_notify_all_staff: value })}
                helpText="Send email notification to all active staff members when ticket is escalated"
              />
            </>
          )}
        </BlockStack>
      </Card>

      <Box>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={saving}
        >
          Save SLA & Escalation Settings
        </Button>
      </Box>
    </BlockStack>
  );
}

// ============================================================================
// SECTION 6: ASSIGNMENT RULES
// ============================================================================

function AssignmentSettings({ settings, onSave, saving }) {
  const [formData, setFormData] = useState({
    default_assignee_id: null,
  });

  const [staff, setStaff] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);

  useEffect(() => {
    fetchStaff();
  }, []);

  useEffect(() => {
    if (settings) {
      setFormData({
        default_assignee_id: settings.default_assignee_id,
      });
    }
  }, [settings]);

  const fetchStaff = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/staff/${SHOP_ID}`);
      if (response.data.success) {
        setStaff(response.data.data.filter(s => s.is_active));
      }
    } catch (error) {
      console.error('Failed to fetch staff:', error);
    } finally {
      setLoadingStaff(false);
    }
  };

  const handleSubmit = () => {
    onSave(formData);
  };

  const staffOptions = [
    { label: 'No default assignee (manual assignment)', value: null },
    ...staff.map(s => ({
      label: `${s.full_name} (${s.email})`,
      value: String(s.id),
    })),
  ];

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <p>Configure default assignment rules for new tickets.</p>
      </Banner>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Default Assignment</Text>

          {loadingStaff ? (
            <SkeletonBodyText lines={2} />
          ) : (
            <Select
              label="Default assignee for new tickets"
              options={staffOptions}
              value={formData.default_assignee_id ? String(formData.default_assignee_id) : ''}
              onChange={(value) => setFormData({ ...formData, default_assignee_id: value ? parseInt(value) : null })}
              helpText="Automatically assign new tickets to this staff member (leave empty for manual assignment)"
            />
          )}

          {staff.length === 0 && !loadingStaff && (
            <Banner tone="warning">
              <p>No staff members found. Sync Shopify staff from the Staff page first.</p>
            </Banner>
          )}
        </BlockStack>
      </Card>

      <Box>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={saving}
        >
          Save Assignment Settings
        </Button>
      </Box>
    </BlockStack>
  );
}

// ============================================================================
// SECTION 7: NOTIFICATIONS
// ============================================================================

function NotificationSettings({ settings, onSave, saving }) {
  const [formData, setFormData] = useState({
    notify_on_new_ticket: false,
    notify_on_escalation: false,
    notify_on_customer_reply: false,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        notify_on_new_ticket: settings.notify_on_new_ticket || false,
        notify_on_escalation: settings.notify_on_escalation || false,
        notify_on_customer_reply: settings.notify_on_customer_reply || false,
      });
    }
  }, [settings]);

  const handleSubmit = () => {
    onSave(formData);
  };

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <p>Control when staff members receive email notifications.</p>
      </Banner>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Email Notifications</Text>

          <Checkbox
            label="Notify on new ticket"
            checked={formData.notify_on_new_ticket}
            onChange={(value) => setFormData({ ...formData, notify_on_new_ticket: value })}
            helpText="Send email to assigned staff when new ticket is created"
          />

          <Checkbox
            label="Notify on customer reply"
            checked={formData.notify_on_customer_reply}
            onChange={(value) => setFormData({ ...formData, notify_on_customer_reply: value })}
            helpText="Send email to assigned staff when customer replies to ticket"
          />

          <Checkbox
            label="Notify on escalation"
            checked={formData.notify_on_escalation}
            onChange={(value) => setFormData({ ...formData, notify_on_escalation: value })}
            helpText="Send email to all staff when ticket is escalated"
          />
        </BlockStack>
      </Card>

      <Box>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={saving}
        >
          Save Notification Settings
        </Button>
      </Box>
    </BlockStack>
  );
}

// ============================================================================
// SECTION 8: TAGS & CATEGORIES
// ============================================================================

function TagsCategoriesSettings({ settings, onSave, saving }) {
  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <p>Tags are automatically assigned based on Shopify customer data and can be managed per-ticket.</p>
      </Banner>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Auto-Tagging Rules</Text>

          <Box padding="300" background="bg-surface-secondary" borderRadius="200">
            <BlockStack gap="200">
              <Text variant="bodyMd" fontWeight="semibold">Customer</Text>
              <Text variant="bodySm" tone="subdued">
                Applied to customers with previous orders. Priority: Normal
              </Text>
            </BlockStack>
          </Box>

          <Box padding="300" background="bg-surface-secondary" borderRadius="200">
            <BlockStack gap="200">
              <Text variant="bodyMd" fontWeight="semibold">Potential Customer</Text>
              <Text variant="bodySm" tone="subdued">
                Applied to visitors with active/abandoned checkouts. Priority: High
              </Text>
            </BlockStack>
          </Box>

          <Box padding="300" background="bg-surface-secondary" borderRadius="200">
            <BlockStack gap="200">
              <Text variant="bodyMd" fontWeight="semibold">Visitor</Text>
              <Text variant="bodySm" tone="subdued">
                Applied to visitors with no orders or checkouts. Priority: Low
              </Text>
            </BlockStack>
          </Box>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Manual Tags</Text>
          <Text variant="bodySm" tone="subdued">
            Staff can add custom tags directly from ticket pages. Common tags will appear as suggestions.
          </Text>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

// ============================================================================
// SECTION 9: CANNED RESPONSES
// ============================================================================

function CannedResponsesSettings() {
  return (
    <BlockStack gap="400">
      <Banner>
        <p>
          Canned responses are quick reply templates. Manage them from the dedicated{' '}
          <strong>Canned Responses</strong> page in the sidebar.
        </p>
      </Banner>

      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">What are Canned Responses?</Text>
          <Text variant="bodySm" tone="subdued">
            Pre-written email templates that staff can insert quickly using shortcuts like <code>/refund</code> or <code>/shipping</code>.
          </Text>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">How to Use</Text>
          <BlockStack gap="200">
            <Text variant="bodySm">1. Create templates with placeholders like <code>{'{{customer_name}}'}</code></Text>
            <Text variant="bodySm">2. Assign shortcuts (e.g., <code>/shipping</code>)</Text>
            <Text variant="bodySm">3. Type the shortcut in ticket replies to insert the template</Text>
          </BlockStack>
        </BlockStack>
      </Card>

      <Box>
        <Button url="/canned-responses">Go to Canned Responses</Button>
      </Box>
    </BlockStack>
  );
}
