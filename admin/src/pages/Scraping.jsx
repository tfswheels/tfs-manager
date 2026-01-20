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
  Spinner
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://tfs-manager-server-production.up.railway.app';

export default function Scraping() {
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [scraperType, setScraperType] = useState('wheels');
  const [scheduleInterval, setScheduleInterval] = useState('24');
  const [activeJob, setActiveJob] = useState(null);

  useEffect(() => {
    fetchJobs();
  }, []);

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

  const startScrapeNow = async () => {
    try {
      setLoading(true);
      const response = await axios.post(`${API_URL}/api/scraping/start`, {
        shop: '2f3d7a-2.myshopify.com',
        scraperType: scraperType
      });

      setActiveJob(response.data.job);
      await fetchJobs();
    } catch (error) {
      console.error('Failed to start scrape:', error);
    } finally {
      setLoading(false);
    }
  };

  const scheduleJob = async () => {
    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/scraping/schedule`, {
        shop: '2f3d7a-2.myshopify.com',
        scraperType: scraperType,
        intervalHours: parseInt(scheduleInterval)
      });

      await fetchJobs();
    } catch (error) {
      console.error('Failed to schedule job:', error);
    } finally {
      setLoading(false);
    }
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

  const rows = jobs.map((job) => [
    job.id,
    job.scraper_type,
    getStatusBadge(job.status),
    job.products_found || 0,
    job.products_created || 0,
    job.products_updated || 0,
    new Date(job.created_at).toLocaleString()
  ]);

  return (
    <Page
      title="Inventory Scraping"
      subtitle="Automate product scraping from suppliers"
    >
      <Layout>
        <Layout.Section>
          {activeJob && (
            <Banner
              tone="info"
              title={`Scraping job ${activeJob.id} is running...`}
              onDismiss={() => setActiveJob(null)}
            >
              <p>The scraper is currently running. This may take several minutes.</p>
            </Banner>
          )}
        </Layout.Section>

        <Layout.Section>
          <Card>
            <div style={{ padding: '20px' }}>
              <Text variant="headingMd" as="h2">
                Start Scrape Now
              </Text>
              <div style={{ marginTop: '16px' }}>
                <Select
                  label="Scraper Type"
                  options={[
                    { label: 'Wheels', value: 'wheels' },
                    { label: 'Tires', value: 'tires' },
                    { label: 'All Products', value: 'all' }
                  ]}
                  value={scraperType}
                  onChange={setScraperType}
                />
              </div>
              <div style={{ marginTop: '16px' }}>
                <Button
                  primary
                  onClick={startScrapeNow}
                  loading={loading}
                  disabled={loading}
                >
                  Start Scrape Now
                </Button>
              </div>
            </div>
          </Card>
        </Layout.Section>

        <Layout.Section secondary>
          <Card>
            <div style={{ padding: '20px' }}>
              <Text variant="headingMd" as="h2">
                Schedule Recurring Scrape
              </Text>
              <div style={{ marginTop: '16px' }}>
                <Select
                  label="Scraper Type"
                  options={[
                    { label: 'Wheels', value: 'wheels' },
                    { label: 'Tires', value: 'tires' },
                    { label: 'All Products', value: 'all' }
                  ]}
                  value={scraperType}
                  onChange={setScraperType}
                />
              </div>
              <div style={{ marginTop: '16px' }}>
                <TextField
                  label="Interval (hours)"
                  type="number"
                  value={scheduleInterval}
                  onChange={setScheduleInterval}
                  helpText="How often to run the scraper"
                />
              </div>
              <div style={{ marginTop: '16px' }}>
                <Button
                  onClick={scheduleJob}
                  loading={loading}
                  disabled={loading}
                >
                  Schedule Job
                </Button>
              </div>
            </div>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <div style={{ padding: '20px' }}>
              <Text variant="headingMd" as="h2">
                Recent Scraping Jobs
              </Text>
              {jobs.length === 0 ? (
                <div style={{ marginTop: '16px', textAlign: 'center', padding: '40px' }}>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    No scraping jobs yet. Start one now!
                  </Text>
                </div>
              ) : (
                <div style={{ marginTop: '16px' }}>
                  <DataTable
                    columnContentTypes={[
                      'text',
                      'text',
                      'text',
                      'numeric',
                      'numeric',
                      'numeric',
                      'text'
                    ]}
                    headings={[
                      'ID',
                      'Type',
                      'Status',
                      'Found',
                      'Created',
                      'Updated',
                      'Started'
                    ]}
                    rows={rows}
                  />
                </div>
              )}
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
