import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  DataTable,
  Badge,
  TextField,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  ProgressBar,
  Layout
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function ProductCreationTab() {
  const [config, setConfig] = useState(null);
  const [todayStats, setTodayStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [maxProducts, setMaxProducts] = useState('1000');
  const [scheduleInterval, setScheduleInterval] = useState('24');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchTodayStats();
    fetchHistory();

    const interval = setInterval(() => {
      fetchConfig();
      fetchTodayStats();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/product-creation/config`, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      const job = response.data.job;
      setConfig(job);
      setMaxProducts(job.max_products_per_run?.toString() || '1000');
      setScheduleInterval(job.schedule_interval?.toString() || '24');
    } catch (error) {
      console.error('Failed to fetch config:', error);
    }
  };

  const fetchTodayStats = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/product-creation/stats/today`, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      setTodayStats(response.data.today);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchHistory = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/product-creation/history`, {
        params: { shop: '2f3d7a-2.myshopify.com', limit: 20 }
      });
      setHistory(response.data.history || []);
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await axios.put(`${API_URL}/api/product-creation/config`, {
        maxProductsPerRun: parseInt(maxProducts),
        scheduleInterval: parseInt(scheduleInterval)
      }, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      await fetchConfig();
      alert('Configuration updated successfully!');
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    if (!window.confirm('Start product creation now? This will create products from scraped data.')) {
      return;
    }

    try {
      setRunning(true);
      await axios.post(`${API_URL}/api/product-creation/run-now`, {}, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      await fetchHistory();
      alert('Product creation started! Check history for progress.');
    } catch (error) {
      console.error('Failed to start product creation:', error);
      alert('Failed to start product creation');
    } finally {
      setRunning(false);
    }
  };

  const handleToggleEnabled = async () => {
    const newEnabledState = !config?.enabled;
    const action = newEnabledState ? 'enable' : 'disable';

    if (!window.confirm(`Are you sure you want to ${action} automated product creation?`)) {
      return;
    }

    try {
      setSaving(true);
      await axios.put(`${API_URL}/api/product-creation/config`, {
        enabled: newEnabledState
      }, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      await fetchConfig();
      alert(`Product creation ${newEnabledState ? 'enabled' : 'disabled'} successfully!`);
    } catch (error) {
      console.error('Failed to toggle enabled state:', error);
      alert(`Failed to ${action} product creation`);
    } finally {
      setSaving(false);
    }
  };

  const formatNextRun = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = date - now;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 0) return 'Due now';
    if (diffMins < 60) return `in ${diffMins} minutes`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `in ${diffHours} hours`;
    const diffDays = Math.floor(diffHours / 24);
    return `in ${diffDays} days`;
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: 'info',
      running: 'attention',
      completed: 'success',
      failed: 'critical'
    };
    return <Badge tone={statusMap[status] || 'info'}>{status}</Badge>;
  };

  const historyRows = history.slice(0, 10).map((job) => [
    new Date(job.created_at).toLocaleString(),
    getStatusBadge(job.status),
    job.products_created || 0,
    job.wheels_created || 0,
    job.tires_created || 0,
    job.completed_at ? new Date(job.completed_at).toLocaleString() : '-'
  ]);

  const progressPercentage = todayStats
    ? Math.min((todayStats.total / todayStats.limit) * 100, 100)
    : 0;

  return (
    <BlockStack gap="400">
      <Banner title="Automated Product Creation" tone="info">
        <p>Products are automatically created in Shopify from scraped inventory data.</p>
        <p>Configure daily limits and schedule to control product creation rate.</p>
      </Banner>

      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Today's Progress</Text>

              {todayStats && (
                <>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text>Products Created Today</Text>
                      <Text variant="headingMd" as="h3">
                        {todayStats.total} / {todayStats.limit}
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={progressPercentage} tone="primary" />
                  </BlockStack>

                  <InlineStack gap="400" align="space-around">
                    <BlockStack gap="100">
                      <Text tone="subdued">Wheels</Text>
                      <Text variant="headingMd" as="h3">{todayStats.wheels}</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text tone="subdued">Tires</Text>
                      <Text variant="headingMd" as="h3">{todayStats.tires}</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text tone="subdued">Remaining</Text>
                      <Text variant="headingMd" as="h3">{todayStats.remaining}</Text>
                    </BlockStack>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section secondary>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Configuration</Text>

              <TextField
                label="Max Products Per Day"
                type="number"
                value={maxProducts}
                onChange={setMaxProducts}
                autoComplete="off"
              />

              <TextField
                label="Schedule Interval (hours)"
                type="number"
                value={scheduleInterval}
                onChange={setScheduleInterval}
                helpText="How often to run product creation"
                autoComplete="off"
              />

              {config && (
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p">
                      <strong>Status:</strong>
                    </Text>
                    <Badge tone={config.enabled ? 'success' : 'critical'}>
                      {config.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </InlineStack>
                  <Text tone="subdued" as="p">
                    <strong>Next Run:</strong> {formatNextRun(config.next_run_at)}
                  </Text>
                  <Text tone="subdued" as="p" fontSize="small">
                    Last updated: {new Date(config.updated_at).toLocaleString()}
                  </Text>
                </BlockStack>
              )}

              <InlineStack gap="200">
                <Button onClick={handleSave} loading={saving}>
                  Save Configuration
                </Button>
                <Button
                  onClick={handleToggleEnabled}
                  loading={saving}
                  tone={config?.enabled ? 'critical' : 'success'}
                >
                  {config?.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button onClick={handleRunNow} loading={running}>
                  Run Now
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Execution History</Text>

          {historyRows.length === 0 ? (
            <Text>No execution history yet</Text>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'numeric', 'numeric', 'numeric', 'text']}
              headings={['Started', 'Status', 'Total', 'Wheels', 'Tires', 'Completed']}
              rows={historyRows}
            />
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
