import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  DataTable,
  Badge,
  Modal,
  TextField,
  Select,
  Checkbox,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  EmptyState
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

const INTERVALS = [
  { label: 'Every 2 hours', value: '2' },
  { label: 'Every 4 hours', value: '4' },
  { label: 'Every 6 hours', value: '6' },
  { label: 'Every 12 hours', value: '12' },
  { label: 'Every 24 hours', value: '24' }
];

export default function ScheduledScrapingTab() {
  const [scheduledJobs, setScheduledJobs] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null);

  // Form state
  const [jobName, setJobName] = useState('');
  const [scraperType, setScraperType] = useState('wheels');
  const [interval, setInterval] = useState('24');
  const [saleOnly, setSaleOnly] = useState(false);
  const [specificBrands, setSpecificBrands] = useState('');
  const [enableDiscovery, setEnableDiscovery] = useState(true);
  const [useZenrows, setUseZenrows] = useState(true);
  const [backorderCount, setBackorderCount] = useState('5');

  useEffect(() => {
    fetchScheduledJobs();
  }, []);

  const fetchScheduledJobs = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/scheduled-scraping`, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      setScheduledJobs(response.data.jobs || []);
    } catch (error) {
      console.error('Failed to fetch scheduled jobs:', error);
    }
  };

  const openCreateModal = () => {
    setEditingJob(null);
    setJobName('');
    setScraperType('wheels');
    setInterval('24');
    setSaleOnly(false);
    setSpecificBrands('');
    setEnableDiscovery(true);
    setUseZenrows(true);
    setBackorderCount('5');
    setModalOpen(true);
  };

  const openEditModal = (job) => {
    setEditingJob(job);
    setJobName(job.name);
    setScraperType(job.scraper_type);
    setInterval(job.schedule_interval.toString());
    setSaleOnly(job.config?.saleOnly || false);
    setSpecificBrands(job.config?.specificBrands?.join(', ') || '');
    setEnableDiscovery(job.config?.enableDiscovery !== false);
    setUseZenrows(job.config?.useZenrows !== false);
    setBackorderCount((job.config?.backorderCount || 5).toString());
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const config = {
        headless: true,
        enableDiscovery,
        enableShopifySync: false, // Always false for scheduled jobs
        useZenrows,
        backorderCount: parseInt(backorderCount) || 5,
        saleOnly,
        specificBrands: specificBrands ? specificBrands.split(',').map(b => b.trim()) : []
      };

      if (editingJob) {
        await axios.put(`${API_URL}/api/scheduled-scraping/${editingJob.id}`, {
          name: jobName,
          scraperType,
          scheduleInterval: parseInt(interval),
          config
        }, {
          params: { shop: '2f3d7a-2.myshopify.com' }
        });
      } else {
        await axios.post(`${API_URL}/api/scheduled-scraping`, {
          name: jobName,
          scraperType,
          scheduleInterval: parseInt(interval),
          config
        }, {
          params: { shop: '2f3d7a-2.myshopify.com' }
        });
      }

      setModalOpen(false);
      fetchScheduledJobs();
    } catch (error) {
      console.error('Failed to save job:', error);
      alert('Failed to save scheduled job');
    }
  };

  const toggleJob = async (jobId) => {
    try {
      await axios.post(`${API_URL}/api/scheduled-scraping/${jobId}/toggle`, {}, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      fetchScheduledJobs();
    } catch (error) {
      console.error('Failed to toggle job:', error);
    }
  };

  const deleteJob = async (jobId) => {
    if (!window.confirm('Are you sure you want to delete this scheduled job?')) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/api/scheduled-scraping/${jobId}`, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      fetchScheduledJobs();
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  };

  const formatNextRun = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = date - now;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 0) return 'Due now';
    if (diffMins < 60) return `in ${diffMins} min`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `in ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `in ${diffDays}d`;
  };

  const jobRows = scheduledJobs.map((job) => [
    job.name,
    job.scraper_type,
    `Every ${job.schedule_interval}h`,
    formatNextRun(job.next_run_at),
    job.last_run_at ? new Date(job.last_run_at).toLocaleString() : 'Never',
    <Badge tone={job.enabled ? 'success' : 'critical'}>
      {job.enabled ? 'Enabled' : 'Disabled'}
    </Badge>,
    <InlineStack gap="200">
      <Button size="slim" onClick={() => toggleJob(job.id)}>
        {job.enabled ? 'Disable' : 'Enable'}
      </Button>
      <Button size="slim" onClick={() => openEditModal(job)}>Edit</Button>
      <Button size="slim" destructive onClick={() => deleteJob(job.id)}>Delete</Button>
    </InlineStack>
  ]);

  return (
    <BlockStack gap="400">
      <Banner title="Scheduled Scraping" tone="info">
        <p>Create scheduled jobs that automatically scrape inventory data at regular intervals.</p>
        <p><strong>Note:</strong> Scraping only saves data to the database. Product creation happens separately.</p>
      </Banner>

      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text variant="headingMd" as="h2">Scheduled Jobs</Text>
            <Button primary onClick={openCreateModal}>Create Scheduled Job</Button>
          </InlineStack>

          {scheduledJobs.length === 0 ? (
            <EmptyState
              heading="No scheduled jobs yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Create your first scheduled scraping job to automate inventory updates</p>
            </EmptyState>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text']}
              headings={['Name', 'Type', 'Interval', 'Next Run', 'Last Run', 'Status', 'Actions']}
              rows={jobRows}
            />
          )}
        </BlockStack>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingJob ? 'Edit Scheduled Job' : 'Create Scheduled Job'}
        primaryAction={{
          content: editingJob ? 'Update' : 'Create',
          onAction: handleSave
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setModalOpen(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Job Name"
              value={jobName}
              onChange={setJobName}
              placeholder="e.g., All Brands Daily, Premium Brands 4hr"
              autoComplete="off"
            />

            <Select
              label="Scraper Type"
              options={[
                { label: 'Wheels', value: 'wheels' },
                { label: 'Tires', value: 'tires' }
              ]}
              value={scraperType}
              onChange={setScraperType}
            />

            <Select
              label="Schedule Interval"
              options={INTERVALS}
              value={interval}
              onChange={setInterval}
            />

            <Checkbox
              label="Enable product discovery (find new products)"
              checked={enableDiscovery}
              onChange={setEnableDiscovery}
            />

            <Checkbox
              label="Use ZenRows (proxy service for scraping)"
              checked={useZenrows}
              onChange={setUseZenrows}
              helpText="When disabled, scrapes without ZenRows proxy"
            />

            <Checkbox
              label="Sale items only"
              checked={saleOnly}
              onChange={setSaleOnly}
            />

            <TextField
              label="Backorder/Made-to-order count"
              type="number"
              value={backorderCount}
              onChange={setBackorderCount}
              autoComplete="off"
              helpText="Stop after N consecutive backorder-only products"
            />

            <TextField
              label="Specific Brands (optional)"
              value={specificBrands}
              onChange={setSpecificBrands}
              placeholder="e.g., Niche, Fuel, KMC"
              helpText="Comma-separated list. Leave empty for all brands."
              autoComplete="off"
              multiline
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
