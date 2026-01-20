import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  Button,
  Layout,
  Text,
  Badge,
  DataTable,
  Select,
  TextField,
  Banner,
  Spinner,
  Modal,
  Checkbox,
  ChoiceList,
  Tabs,
  BlockStack,
  InlineStack
} from '@shopify/polaris';
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
  const [selectedTab, setSelectedTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [brands, setBrands] = useState([]);
  const [excludedBrands, setExcludedBrands] = useState(SKIP_BRANDS_DEFAULT);

  // Scraper settings - Wheels
  const [wheelsSettings, setWheelsSettings] = useState({
    scraperType: 'wheels',
    headless: true,
    enableDiscovery: true,
    enableShopifySync: true,
    maxProductsPerDay: 1000,
    retryFailed: true,
    saleOnly: false,
    scheduleEnabled: false,
    scheduleInterval: '24'
  });

  // Scraper settings - Tires
  const [tiresSettings, setTiresSettings] = useState({
    scraperType: 'tires',
    headless: true,
    enableDiscovery: true,
    enableShopifySync: true,
    maxProductsPerDay: 1000,
    retryFailed: true,
    saleOnly: false,
    scheduleEnabled: false,
    scheduleInterval: '24'
  });

  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLogsOpen, setJobLogsOpen] = useState(false);
  const [jobLogs, setJobLogs] = useState('');

  useEffect(() => {
    fetchJobs();
    fetchBrands();

    // Poll for job updates every 5 seconds
    const interval = setInterval(fetchJobs, 5000);
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

  const startScraping = async (settings) => {
    try {
      setLoading(true);
      const response = await axios.post(`${API_URL}/api/scraping/start`, {
        shop: '2f3d7a-2.myshopify.com',
        scraperType: settings.scraperType,
        config: {
          headless: settings.headless,
          enableDiscovery: settings.enableDiscovery,
          enableShopifySync: settings.enableShopifySync,
          maxProductsPerDay: settings.maxProductsPerDay,
          retryFailed: settings.retryFailed,
          saleOnly: settings.saleOnly,
          excludedBrands: excludedBrands
        }
      });

      await fetchJobs();
    } catch (error) {
      console.error('Failed to start scraping:', error);
    } finally {
      setLoading(false);
    }
  };

  const viewJobLogs = async (job) => {
    setSelectedJob(job);
    setJobLogsOpen(true);

    // Fetch job logs (placeholder - we'll implement log streaming)
    setJobLogs(`Fetching logs for job #${job.id}...\n\nThis feature will show real-time logs from the scraper.`);
  };

  const terminateJob = async (jobId) => {
    if (!window.confirm(`Are you sure you want to terminate job #${jobId}? This cannot be undone.`)) {
      return;
    }

    try {
      await axios.post(`${API_URL}/api/scraping/terminate/${jobId}`, {}, {
        params: { shop: '2f3d7a-2.myshopify.com' }
      });

      // Refresh jobs list
      await fetchJobs();
    } catch (error) {
      console.error('Failed to terminate job:', error);
      alert('Failed to terminate job. It may have already completed.');
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

  const jobRows = jobs.map((job) => [
    <Button plain onClick={() => viewJobLogs(job)}>{job.id}</Button>,
    job.scraper_type,
    getStatusBadge(job.status),
    job.products_found || 0,
    job.products_created || 0,
    job.products_updated || 0,
    new Date(job.created_at).toLocaleString(),
    job.status === 'running' ? (
      <InlineStack gap="200">
        <Spinner size="small" />
        <Button
          size="slim"
          destructive
          onClick={() => terminateJob(job.id)}
        >
          Terminate
        </Button>
      </InlineStack>
    ) : '-'
  ]);

  const tabs = [
    { id: 'wheels', content: 'Wheels', },
    { id: 'tires', content: 'Tires' },
    { id: 'brands', content: 'Brand Management' },
    { id: 'jobs', content: `Jobs (${jobs.length})` }
  ];

  const renderWheelsTab = () => (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Wheels Scraping Configuration</Text>

            <Checkbox
              label="Headless mode (run browser in background)"
              checked={wheelsSettings.headless}
              onChange={(value) => setWheelsSettings({...wheelsSettings, headless: value})}
            />

            <Checkbox
              label="Enable product discovery (find new products)"
              checked={wheelsSettings.enableDiscovery}
              onChange={(value) => setWheelsSettings({...wheelsSettings, enableDiscovery: value})}
            />

            <Checkbox
              label="Enable Shopify sync (create products in Shopify)"
              checked={wheelsSettings.enableShopifySync}
              onChange={(value) => setWheelsSettings({...wheelsSettings, enableShopifySync: value})}
            />

            <Checkbox
              label="Retry failed products"
              checked={wheelsSettings.retryFailed}
              onChange={(value) => setWheelsSettings({...wheelsSettings, retryFailed: value})}
            />

            <Checkbox
              label="Sale items only"
              checked={wheelsSettings.saleOnly}
              onChange={(value) => setWheelsSettings({...wheelsSettings, saleOnly: value})}
            />

            <TextField
              label="Max products per day"
              type="number"
              value={String(wheelsSettings.maxProductsPerDay)}
              onChange={(value) => setWheelsSettings({...wheelsSettings, maxProductsPerDay: parseInt(value) || 1000})}
              helpText="Daily limit for new product creation"
            />

            <InlineStack gap="300">
              <Button
                primary
                onClick={() => startScraping(wheelsSettings)}
                loading={loading}
                disabled={loading}
              >
                Start Wheels Scraping Now
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section secondary>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Schedule Recurring Scrape</Text>

            <Checkbox
              label="Enable scheduled scraping"
              checked={wheelsSettings.scheduleEnabled}
              onChange={(value) => setWheelsSettings({...wheelsSettings, scheduleEnabled: value})}
            />

            {wheelsSettings.scheduleEnabled && (
              <>
                <TextField
                  label="Interval (hours)"
                  type="number"
                  value={wheelsSettings.scheduleInterval}
                  onChange={(value) => setWheelsSettings({...wheelsSettings, scheduleInterval: value})}
                  helpText="How often to run the scraper"
                />

                <Button onClick={() => console.log('Schedule wheels scraping')}>
                  Save Schedule
                </Button>
              </>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );

  const renderTiresTab = () => (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Tires Scraping Configuration</Text>

            <Checkbox
              label="Headless mode (run browser in background)"
              checked={tiresSettings.headless}
              onChange={(value) => setTiresSettings({...tiresSettings, headless: value})}
            />

            <Checkbox
              label="Enable product discovery (find new products)"
              checked={tiresSettings.enableDiscovery}
              onChange={(value) => setTiresSettings({...tiresSettings, enableDiscovery: value})}
            />

            <Checkbox
              label="Enable Shopify sync (create products in Shopify)"
              checked={tiresSettings.enableShopifySync}
              onChange={(value) => setTiresSettings({...tiresSettings, enableShopifySync: value})}
            />

            <Checkbox
              label="Retry failed products"
              checked={tiresSettings.retryFailed}
              onChange={(value) => setTiresSettings({...tiresSettings, retryFailed: value})}
            />

            <Checkbox
              label="Sale items only"
              checked={tiresSettings.saleOnly}
              onChange={(value) => setTiresSettings({...tiresSettings, saleOnly: value})}
            />

            <TextField
              label="Max products per day"
              type="number"
              value={String(tiresSettings.maxProductsPerDay)}
              onChange={(value) => setTiresSettings({...tiresSettings, maxProductsPerDay: parseInt(value) || 1000})}
              helpText="Daily limit for new product creation"
            />

            <InlineStack gap="300">
              <Button
                primary
                onClick={() => startScraping(tiresSettings)}
                loading={loading}
                disabled={loading}
              >
                Start Tires Scraping Now
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section secondary>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Schedule Recurring Scrape</Text>

            <Checkbox
              label="Enable scheduled scraping"
              checked={tiresSettings.scheduleEnabled}
              onChange={(value) => setTiresSettings({...tiresSettings, scheduleEnabled: value})}
            />

            {tiresSettings.scheduleEnabled && (
              <>
                <TextField
                  label="Interval (hours)"
                  type="number"
                  value={tiresSettings.scheduleInterval}
                  onChange={(value) => setTiresSettings({...tiresSettings, scheduleInterval: value})}
                  helpText="How often to run the scraper"
                />

                <Button onClick={() => console.log('Schedule tires scraping')}>
                  Save Schedule
                </Button>
              </>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );

  const renderBrandsTab = () => (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Excluded Brands</Text>
            <Text variant="bodyMd" as="p" tone="subdued">
              Products from these brands will be skipped during scraping ({excludedBrands.length} brands excluded)
            </Text>

            <div style={{
              maxHeight: '400px',
              overflowY: 'auto',
              border: '1px solid #e1e3e5',
              borderRadius: '8px',
              padding: '16px'
            }}>
              {brands.map((brand) => (
                <div key={brand} style={{ marginBottom: '8px' }}>
                  <Checkbox
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
                </div>
              ))}
            </div>

            <InlineStack gap="300">
              <Button onClick={() => setExcludedBrands([])}>Clear All</Button>
              <Button onClick={() => setExcludedBrands(SKIP_BRANDS_DEFAULT)}>Reset to Default</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section secondary>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Brand Statistics</Text>
            <Text variant="bodyMd" as="p">
              Total brands in database: {brands.length}
            </Text>
            <Text variant="bodyMd" as="p">
              Excluded brands: {excludedBrands.length}
            </Text>
            <Text variant="bodyMd" as="p">
              Active brands: {brands.length - excludedBrands.length}
            </Text>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );

  const renderJobsTab = () => (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">Scraping Jobs History</Text>

        {jobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Text variant="bodyMd" as="p" tone="subdued">
              No scraping jobs yet. Start one from the Wheels or Tires tab!
            </Text>
          </div>
        ) : (
          <DataTable
            columnContentTypes={[
              'text',
              'text',
              'text',
              'numeric',
              'numeric',
              'numeric',
              'text',
              'text'
            ]}
            headings={[
              'ID',
              'Type',
              'Status',
              'Found',
              'Created',
              'Updated',
              'Started',
              'Progress'
            ]}
            rows={jobRows}
          />
        )}
      </BlockStack>
    </Card>
  );

  return (
    <Page
      title="Products & Inventory"
      subtitle="Manage product scraping, brand exclusions, and inventory automation"
    >
      <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
        <div style={{ marginTop: '20px' }}>
          {selectedTab === 0 && renderWheelsTab()}
          {selectedTab === 1 && renderTiresTab()}
          {selectedTab === 2 && renderBrandsTab()}
          {selectedTab === 3 && renderJobsTab()}
        </div>
      </Tabs>

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
