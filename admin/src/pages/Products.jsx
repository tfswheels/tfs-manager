import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  Button,
  Layout,
  Text,
  Badge,
  DataTable,
  TextField,
  Banner,
  Spinner,
  Modal,
  Checkbox,
  Collapsible,
  BlockStack,
  InlineStack,
  Divider,
  Icon
} from '@shopify/polaris';
import { ChevronDownIcon, ChevronUpIcon } from '@shopify/polaris-icons';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

const SKIP_BRANDS_DEFAULT = [
  "4 Play", "American Racing", "American Truxx", "Asanti", "Black Rhino",
  "DUB", "Dropstars", "Fuel", "ICON Alloys", "KMC", "Luxxx", "Mayhem",
  "Moto Metal", "XD Series", "Ultra Wheel", "Milanni", "Red Dirt Road",
  "RTX", "Seventy7", "Status", "TIS", "TSW", "Vision Wheel", "XF Off-Road",
  "Lexani", "Factory Reproductions", "Grid Off-Road", "17x9 Matte Black",
  "17x9 Gloss Black Milled", "Cali Off-Road", "OE Creations", "Helo",
  "Alliance", "Foose", "Rotiform", "Verde", "US Mags", "DPR Off-Road",
  "American Force", "American Racing Custom", "Asanti Off-Road", "ATX",
  "Ballistic", "Black Label", "BMF Off-Road", "Brute", "Contrast",
  "Cruiser Alloy", "Dick Cepek", "Dirty Life", "DLUX", "Dropstar", "F1R",
  "F1R Wheels", "Forgiato", "Fuel Off-Road", "HE Wheels", "ION", "Kansei",
  "Konig", "Konig Wheels", "Mayhem Wheels", "Method Race", "OE Performance",
  "Offroad Monster", "RBP", "Red Sport", "Rosso"
];

export default function Products() {
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [brands, setBrands] = useState([]);
  const [excludedBrands, setExcludedBrands] = useState(SKIP_BRANDS_DEFAULT);
  const [configOpen, setConfigOpen] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);

  // Global configuration (applies to both wheels and tires)
  const [config, setConfig] = useState({
    headless: true,
    enableDiscovery: true,
    enableShopifySync: true,
    maxProductsPerDay: 1000,
    retryFailed: true,
    saleOnly: false
  });

  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLogsOpen, setJobLogsOpen] = useState(false);
  const [jobLogs, setJobLogs] = useState('');

  // Get today's creation stats
  const [todayStats, setTodayStats] = useState({ wheels: 0, tires: 0, total: 0, remaining: 1000 });

  useEffect(() => {
    fetchJobs();
    fetchBrands();
    fetchTodayStats();

    const interval = setInterval(() => {
      fetchJobs();
      fetchTodayStats();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchBrands = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/brands`, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      setBrands(response.data.brands || []);
    } catch (error) {
      console.error('Failed to fetch brands:', error);
    }
  };

  const fetchJobs = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/scraping/jobs`, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      setJobs(response.data.jobs || []);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    }
  };

  const fetchTodayStats = async () => {
    try {
      // This is a placeholder - you'll need to implement this endpoint
      // For now, calculate from jobs
      const today = new Date().toDateString();
      const todayJobs = jobs.filter(job => new Date(job.created_at).toDateString() === today);
      const wheelsCreated = todayJobs.filter(j => j.scraper_type === 'wheels').reduce((sum, j) => sum + (j.products_created || 0), 0);
      const tiresCreated = todayJobs.filter(j => j.scraper_type === 'tires').reduce((sum, j) => sum + (j.products_created || 0), 0);
      const total = wheelsCreated + tiresCreated;
      setTodayStats({
        wheels: wheelsCreated,
        tires: tiresCreated,
        total,
        remaining: Math.max(0, config.maxProductsPerDay - total)
      });
    } catch (error) {
      console.error('Failed to fetch today stats:', error);
    }
  };

  const startScraping = async (scraperType) => {
    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/scraping/start`, {
        shop: '2f3d7a-2.myshopify.com',
        scraperType,
        config: {
          ...config,
          excludedBrands
        }
      });

      await fetchJobs();
    } catch (error) {
      console.error('Failed to start scraping:', error);
      alert(error.response?.data?.message || 'Failed to start scraping');
    } finally {
      setLoading(false);
    }
  };

  const viewJobLogs = async (job) => {
    setSelectedJob(job);
    setJobLogsOpen(true);

    const railwayUrl = 'https://railway.app';
    setJobLogs(
`Job #${job.id} - ${job.scraper_type}
Status: ${job.status}
Started: ${job.started_at ? new Date(job.started_at).toLocaleString() : 'Not started'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To view real-time logs for this scraping job:

1. Go to Railway Dashboard: ${railwayUrl}
2. Select "TFS Manager Server"
3. Click on the "Deployments" tab
4. Click on the latest deployment
5. View the logs and search for:
   [Scraper #${job.id}]

The logs will show:
• Product scraping progress
• Product creation attempts
• Success/failure messages
• Error details (if any)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Job Statistics:
• Products Found: ${job.products_found || 0}
• Products Created: ${job.products_created || 0}
• Products Updated: ${job.products_updated || 0}
`
    );
  };

  const terminateJob = async (jobId) => {
    if (!window.confirm(`Are you sure you want to terminate job #${jobId}?`)) {
      return;
    }

    try {
      await axios.post(`${API_URL}/api/scraping/terminate/${jobId}`, {}, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });
      await fetchJobs();
    } catch (error) {
      console.error('Failed to terminate job:', error);
      alert(error.response?.data?.message || 'Failed to terminate job');
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: 'info',
      running: 'attention',
      completed: 'success',
      failed: 'critical',
      terminated: 'warning'
    };
    return <Badge tone={statusMap[status] || 'info'}>{status}</Badge>;
  };

  const runningJobs = jobs.filter(j => j.status === 'running');
  const recentJobs = jobs.slice(0, 10);

  const jobRows = recentJobs.map((job) => [
    <Button plain onClick={() => viewJobLogs(job)}>{job.id}</Button>,
    job.scraper_type,
    getStatusBadge(job.status),
    job.products_found || 0,
    job.products_created || 0,
    job.products_updated || 0,
    new Date(job.created_at).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }),
    job.status === 'running' ? (
      <InlineStack gap="200">
        <Spinner size="small" />
        <Button size="slim" destructive onClick={() => terminateJob(job.id)}>
          Stop
        </Button>
      </InlineStack>
    ) : '-'
  ]);

  return (
    <Page
      title="Products & Inventory"
      subtitle="Automated product scraping from CustomWheelOffset.com"
    >
      <Layout>
        {/* Quick Actions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="headingMd" as="h2">Quick Start</Text>
                <Button
                  plain
                  icon={configOpen ? ChevronUpIcon : ChevronDownIcon}
                  onClick={() => setConfigOpen(!configOpen)}
                >
                  {configOpen ? 'Hide' : 'Show'} Configuration
                </Button>
              </div>

              <InlineStack gap="300">
                <Button
                  primary
                  size="large"
                  onClick={() => startScraping('wheels')}
                  loading={loading}
                  disabled={loading || runningJobs.length > 0}
                >
                  Start Wheels Scraping
                </Button>
                <Button
                  primary
                  size="large"
                  onClick={() => startScraping('tires')}
                  loading={loading}
                  disabled={loading || runningJobs.length > 0}
                >
                  Start Tires Scraping
                </Button>
              </InlineStack>

              {runningJobs.length > 0 && (
                <Banner tone="info">
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text variant="bodyMd">
                      {runningJobs.length} job{runningJobs.length > 1 ? 's' : ''} currently running
                    </Text>
                  </InlineStack>
                </Banner>
              )}

              <Collapsible open={configOpen} id="config-collapsible">
                <BlockStack gap="400">
                  <Divider />
                  <Text variant="headingSm" as="h3">Global Configuration</Text>
                  <Text variant="bodySm" tone="subdued">
                    These settings apply to both wheels and tires scraping
                  </Text>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <Checkbox
                      label="Headless mode"
                      helpText="Run browser in background"
                      checked={config.headless}
                      onChange={(value) => setConfig({...config, headless: value})}
                    />
                    <Checkbox
                      label="Product discovery"
                      helpText="Find and create new products"
                      checked={config.enableDiscovery}
                      onChange={(value) => setConfig({...config, enableDiscovery: value})}
                    />
                    <Checkbox
                      label="Shopify sync"
                      helpText="Create products in Shopify"
                      checked={config.enableShopifySync}
                      onChange={(value) => setConfig({...config, enableShopifySync: value})}
                    />
                    <Checkbox
                      label="Retry failed"
                      helpText="Retry previously failed products"
                      checked={config.retryFailed}
                      onChange={(value) => setConfig({...config, retryFailed: value})}
                    />
                    <Checkbox
                      label="Sale items only"
                      helpText="Only scrape products on sale"
                      checked={config.saleOnly}
                      onChange={(value) => setConfig({...config, saleOnly: value})}
                    />
                  </div>

                  <TextField
                    label="Max products per day (cumulative)"
                    type="number"
                    value={String(config.maxProductsPerDay)}
                    onChange={(value) => setConfig({...config, maxProductsPerDay: parseInt(value) || 1000})}
                    helpText={`Combined limit for wheels AND tires. Today: ${todayStats.total}/${config.maxProductsPerDay} created, ${todayStats.remaining} remaining`}
                    autoComplete="off"
                  />

                  <div>
                    <Button
                      plain
                      icon={brandsOpen ? ChevronUpIcon : ChevronDownIcon}
                      onClick={() => setBrandsOpen(!brandsOpen)}
                    >
                      {brandsOpen ? 'Hide' : 'Manage'} Excluded Brands ({excludedBrands.length} brands)
                    </Button>

                    <Collapsible open={brandsOpen} id="brands-collapsible">
                      <div style={{
                        marginTop: '16px',
                        maxHeight: '300px',
                        overflowY: 'auto',
                        border: '1px solid #e1e3e5',
                        borderRadius: '8px',
                        padding: '12px'
                      }}>
                        {brands.length === 0 ? (
                          <Text variant="bodyMd" tone="subdued">Loading brands...</Text>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                            {brands.map((brand) => (
                              <Checkbox
                                key={brand}
                                label={brand}
                                checked={excludedBrands.includes(brand)}
                                onChange={(checked) => {
                                  if (checked) {
                                    setExcludedBrands([...excludedBrands, brand]);
                                  } else {
                                    setExcludedBrands(excludedBrands.filter(b => b !== brand));
                                  }
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{ marginTop: '12px' }}>
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => setExcludedBrands([])}>Clear All</Button>
                          <Button size="slim" onClick={() => setExcludedBrands(SKIP_BRANDS_DEFAULT)}>Reset to Default</Button>
                        </InlineStack>
                      </div>
                    </Collapsible>
                  </div>
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Today's Stats */}
        <Layout.Section secondary>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Today's Activity</Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                <div style={{ padding: '12px', background: '#f6f6f7', borderRadius: '8px' }}>
                  <Text variant="headingSm" as="p" fontWeight="semibold">Wheels Created</Text>
                  <Text variant="heading2xl" as="p">{todayStats.wheels}</Text>
                </div>
                <div style={{ padding: '12px', background: '#f6f6f7', borderRadius: '8px' }}>
                  <Text variant="headingSm" as="p" fontWeight="semibold">Tires Created</Text>
                  <Text variant="heading2xl" as="p">{todayStats.tires}</Text>
                </div>
                <div style={{ padding: '12px', background: todayStats.remaining === 0 ? '#ffebee' : '#e8f5e9', borderRadius: '8px' }}>
                  <Text variant="headingSm" as="p" fontWeight="semibold">Remaining Today</Text>
                  <Text variant="heading2xl" as="p" tone={todayStats.remaining === 0 ? 'critical' : 'success'}>
                    {todayStats.remaining}
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    of {config.maxProductsPerDay}
                  </Text>
                </div>
              </div>

              {runningJobs.length > 0 && (
                <>
                  <Divider />
                  <Text variant="headingSm" as="h3">Active Jobs</Text>
                  {runningJobs.map(job => (
                    <div key={job.id} style={{ padding: '12px', background: '#fffbea', borderRadius: '8px', border: '1px solid #ffd666' }}>
                      <InlineStack gap="200" blockAlign="center">
                        <Spinner size="small" />
                        <div>
                          <Text variant="bodyMd" fontWeight="semibold">Job #{job.id}</Text>
                          <Text variant="bodySm" tone="subdued">{job.scraper_type}</Text>
                        </div>
                      </InlineStack>
                    </div>
                  ))}
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent Jobs */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="headingMd" as="h2">Recent Jobs</Text>
                <Text variant="bodyMd" tone="subdued">{jobs.length} total jobs</Text>
              </div>

              {recentJobs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <Text variant="bodyMd" tone="subdued">
                    No jobs yet. Click a button above to start scraping!
                  </Text>
                </div>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'text', 'text']}
                  headings={['ID', 'Type', 'Status', 'Found', 'Created', 'Updated', 'Started', 'Actions']}
                  rows={jobRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Job Logs Modal */}
      <Modal
        open={jobLogsOpen}
        onClose={() => setJobLogsOpen(false)}
        title={`Job #${selectedJob?.id} Logs`}
        primaryAction={{
          content: 'Close',
          onAction: () => setJobLogsOpen(false)
        }}
      >
        <Modal.Section>
          <div style={{
            backgroundColor: '#1a1a1a',
            color: '#00ff00',
            padding: '16px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
            maxHeight: '500px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap'
          }}>
            {jobLogs || 'No logs available yet...'}
          </div>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
