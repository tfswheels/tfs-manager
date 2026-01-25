import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  DataTable,
  Badge,
  Checkbox,
  Collapsible,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Spinner,
  Icon,
  TextField,
  Modal,
  ChoiceList
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

export default function ManualScrapingTab() {
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [brands, setBrands] = useState([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);

  const [excludedBrands, setExcludedBrands] = useState(SKIP_BRANDS_DEFAULT);
  const [config, setConfig] = useState({
    scrapingMode: 'zenrows',
    hybridRetryCount: 3,
    backorderCount: 5,
    retryFailed: true,
    saleOnly: false,
    useSpecificBrands: false
  });
  const [specificBrandsInput, setSpecificBrandsInput] = useState('');

  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLogsOpen, setJobLogsOpen] = useState(false);

  useEffect(() => {
    fetchJobs();
    fetchBrands();
    const interval = setInterval(fetchJobs, 30000);
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

  const startScraping = async (scraperType) => {
    try {
      setLoading(true);

      const specificBrands = config.useSpecificBrands && specificBrandsInput
        ? specificBrandsInput.split(',').map(b => b.trim()).filter(b => b.length > 0)
        : [];

      await axios.post(`${API_URL}/api/scraping/start`, {
        shop: '2f3d7a-2.myshopify.com',
        scraperType,
        config: {
          ...config,
          excludedBrands,
          specificBrands
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

  const viewJobLogs = async (job) => {
    setSelectedJob(job);
    setJobLogsOpen(true);
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
    <BlockStack gap="400">
      <Banner title="Manual Scraping" tone="info">
        <p>Run one-time scraping jobs on demand with custom configuration.</p>
        <p>Use this for immediate needs or testing before creating scheduled jobs.</p>
      </Banner>

      {/* Quick Actions */}
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Quick Scrape</Text>

          {runningJobs.length > 0 && (
            <Banner tone="warning">
              {runningJobs.length} job(s) currently running
            </Banner>
          )}

          <InlineStack gap="300">
            <Button
              primary
              loading={loading}
              onClick={() => startScraping('wheels')}
            >
              Scrape Wheels Now
            </Button>
            <Button
              loading={loading}
              onClick={() => startScraping('tires')}
            >
              Scrape Tires Now
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>

      {/* Configuration */}
      <Card>
        <BlockStack gap="400">
          <Button
            onClick={() => setConfigOpen(!configOpen)}
            ariaExpanded={configOpen}
            ariaControls="scraping-config"
            fullWidth
            textAlign="left"
            disclosure={configOpen ? 'up' : 'down'}
          >
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h2">Scraping Configuration</Text>
            </InlineStack>
          </Button>

          <Collapsible
            open={configOpen}
            id="scraping-config"
            transition={{duration: '200ms', timingFunction: 'ease-in-out'}}
          >
            <BlockStack gap="400">
              <ChoiceList
                title="Scraping Mode"
                choices={[
                  {
                    label: 'Direct Scraping',
                    value: 'direct',
                    helpText: 'Scrape directly without proxy (faster, may be blocked)'
                  },
                  {
                    label: 'Use ZenRows',
                    value: 'zenrows',
                    helpText: 'Always use ZenRows proxy service (slower, more reliable)'
                  },
                  {
                    label: 'Hybrid',
                    value: 'hybrid',
                    helpText: 'Start with direct, fallback to ZenRows on failure'
                  }
                ]}
                selected={[config.scrapingMode]}
                onChange={(selected) => setConfig({...config, scrapingMode: selected[0]})}
              />

              {config.scrapingMode === 'hybrid' && (
                <TextField
                  label="Hybrid Retry Count"
                  type="number"
                  value={config.hybridRetryCount.toString()}
                  onChange={(val) => setConfig({...config, hybridRetryCount: parseInt(val) || 3})}
                  autoComplete="off"
                  helpText="Number of direct attempts before using ZenRows"
                  min="1"
                  max="10"
                />
              )}

              <Checkbox
                label="Sale items only"
                checked={config.saleOnly}
                onChange={(val) => setConfig({...config, saleOnly: val})}
              />
              <Checkbox
                label="Use specific brands only"
                checked={config.useSpecificBrands}
                onChange={(val) => setConfig({...config, useSpecificBrands: val})}
              />

              {config.useSpecificBrands && (
                <TextField
                  label="Specific Brands"
                  value={specificBrandsInput}
                  onChange={setSpecificBrandsInput}
                  placeholder="e.g., Niche, Fuel, KMC"
                  helpText="Comma-separated list"
                  autoComplete="off"
                  multiline
                />
              )}

              <TextField
                label="Backorder/Made-to-order count"
                type="number"
                value={config.backorderCount.toString()}
                onChange={(val) => setConfig({...config, backorderCount: parseInt(val) || 5})}
                autoComplete="off"
                helpText="Stop after N consecutive backorder-only products"
              />
            </BlockStack>
          </Collapsible>
        </BlockStack>
      </Card>

      {/* Excluded Brands */}
      <Card>
        <BlockStack gap="400">
          <Button
            onClick={() => setBrandsOpen(!brandsOpen)}
            ariaExpanded={brandsOpen}
            ariaControls="excluded-brands"
            fullWidth
            textAlign="left"
            disclosure={brandsOpen ? 'up' : 'down'}
          >
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h2">
                Excluded Brands ({excludedBrands.length} selected)
              </Text>
            </InlineStack>
          </Button>

          <Collapsible
            open={brandsOpen}
            id="excluded-brands"
            transition={{duration: '200ms', timingFunction: 'ease-in-out'}}
          >
            <BlockStack gap="400">
              <Text tone="subdued">
                Select brands to exclude from scraping:
              </Text>

              <InlineStack gap="200">
                <Button
                  size="slim"
                  onClick={() => {
                    const allBrands = brands.length > 0 ? brands : SKIP_BRANDS_DEFAULT;
                    setExcludedBrands(allBrands);
                  }}
                >
                  Select All
                </Button>
                <Button
                  size="slim"
                  onClick={() => setExcludedBrands([])}
                >
                  Deselect All
                </Button>
              </InlineStack>

              <div style={{
                maxHeight: '400px',
                overflowY: 'auto',
                padding: '16px',
                backgroundColor: '#f6f6f7',
                borderRadius: '8px'
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px'
                }}>
                  {(brands.length > 0 ? brands : SKIP_BRANDS_DEFAULT).map((brand) => (
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
              </div>

              <TextField
                label="Add custom brand to exclude (comma-separated)"
                placeholder="e.g., Brand1, Brand2, Brand3"
                autoComplete="off"
                onBlur={(e) => {
                  const newBrands = e.target.value
                    .split(',')
                    .map(b => b.trim())
                    .filter(b => b && !excludedBrands.includes(b));
                  if (newBrands.length > 0) {
                    setExcludedBrands([...excludedBrands, ...newBrands]);
                    e.target.value = '';
                  }
                }}
              />
            </BlockStack>
          </Collapsible>
        </BlockStack>
      </Card>

      {/* Job History */}
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text variant="headingMd" as="h2">Recent Jobs</Text>
            <Button onClick={fetchJobs}>Refresh</Button>
          </InlineStack>

          <DataTable
            columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'text', 'text']}
            headings={['ID', 'Type', 'Status', 'Found', 'Created', 'Updated', 'Started', 'Actions']}
            rows={jobRows}
          />
        </BlockStack>
      </Card>

      {/* Job Logs Modal */}
      <Modal
        open={jobLogsOpen}
        onClose={() => setJobLogsOpen(false)}
        title={`Job #${selectedJob?.id} - ${selectedJob?.scraper_type}`}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <InlineStack gap="400">
              <Text>Status: {getStatusBadge(selectedJob?.status)}</Text>
              <Text>Started: {selectedJob?.started_at ? new Date(selectedJob.started_at).toLocaleString() : 'Not started'}</Text>
            </InlineStack>

            <Text variant="headingMd" as="h3">Statistics</Text>
            <InlineStack gap="400">
              <Text>Found: {selectedJob?.products_found || 0}</Text>
              <Text>Created: {selectedJob?.products_created || 0}</Text>
              <Text>Updated: {selectedJob?.products_updated || 0}</Text>
            </InlineStack>

            <Banner tone="info">
              <p>To view real-time logs, check your Railway deployment logs and search for:</p>
              <p><strong>[Scraper #{selectedJob?.id}]</strong></p>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
