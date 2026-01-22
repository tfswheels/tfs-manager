import db from '../config/database.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track running processes to prevent duplicates
const runningJobs = new Map();

/**
 * Job Scheduler Service
 * Checks for scheduled jobs that need to run and executes them
 */
class JobScheduler {
  constructor() {
    this.checkInterval = 60000; // Check every minute
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️  Job scheduler is already running');
      return;
    }

    console.log('🚀 Starting job scheduler...');
    console.log(`⏰ Check interval: ${this.checkInterval / 1000} seconds`);

    this.isRunning = true;

    // Run immediately on start
    this.checkJobs();

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.checkJobs();
    }, this.checkInterval);

    console.log('✅ Job scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isRunning = false;
      console.log('🛑 Job scheduler stopped');
    }
  }

  /**
   * Check for jobs that need to run
   */
  async checkJobs() {
    try {
      await this.checkScheduledScrapeJobs();
      await this.checkProductCreationJobs();
    } catch (error) {
      console.error('❌ Error checking jobs:', error);
    }
  }

  /**
   * Check for scheduled scrape jobs that need to run
   */
  async checkScheduledScrapeJobs() {
    try {
      // Find jobs where next_run_at <= NOW and enabled = true
      const [jobs] = await db.execute(
        `SELECT * FROM scheduled_scrape_jobs
         WHERE enabled = TRUE
         AND next_run_at <= NOW()
         ORDER BY next_run_at ASC`
      );

      if (jobs.length === 0) {
        return;
      }

      console.log(`📋 Found ${jobs.length} scheduled scrape job(s) to run`);

      for (const job of jobs) {
        // Skip if already running
        if (runningJobs.has(`scrape_${job.id}`)) {
          console.log(`  ⏭️  Skipping job "${job.name}" - already running`);
          continue;
        }

        console.log(`  🚀 Starting scheduled job: ${job.name} (${job.scraper_type})`);
        await this.executeScheduledScrapeJob(job);
      }
    } catch (error) {
      console.error('❌ Error checking scheduled scrape jobs:', error);
    }
  }

  /**
   * Execute a scheduled scrape job
   */
  async executeScheduledScrapeJob(scheduledJob) {
    try {
      const config = typeof scheduledJob.config === 'string'
        ? JSON.parse(scheduledJob.config)
        : scheduledJob.config;

      // Create a scraping_jobs entry
      const [result] = await db.execute(
        `INSERT INTO scraping_jobs (
          shop_id,
          scraper_type,
          config,
          status,
          scheduled_job_id,
          started_at,
          created_at
        ) VALUES (?, ?, ?, 'running', ?, NOW(), NOW())`,
        [
          scheduledJob.shop_id,
          scheduledJob.scraper_type,
          JSON.stringify(config),
          scheduledJob.id
        ]
      );

      const jobId = result.insertId;

      // Update scheduled job's last run info
      await db.execute(
        `UPDATE scheduled_scrape_jobs
         SET last_run_at = NOW(),
             last_run_job_id = ?
         WHERE id = ?`,
        [jobId, scheduledJob.id]
      );

      // Calculate next run time
      const nextRunAt = new Date();
      nextRunAt.setHours(nextRunAt.getHours() + scheduledJob.schedule_interval);

      await db.execute(
        `UPDATE scheduled_scrape_jobs
         SET next_run_at = ?
         WHERE id = ?`,
        [nextRunAt, scheduledJob.id]
      );

      console.log(`  ✅ Created scraping job #${jobId} for scheduled job "${scheduledJob.name}"`);
      console.log(`  ⏰ Next run scheduled for: ${nextRunAt.toISOString()}`);

      // Spawn Python scraper
      const scraperPath = path.join(__dirname, '../../workers/scrapers');
      const pythonScript = path.join(scraperPath, 'run_scraper.py');

      const args = [
        pythonScript,
        `--job-id=${jobId}`,
        `--type=${scheduledJob.scraper_type}`
      ];

      // Add config flags
      if (config.headless === false) args.push('--headed');
      if (config.saleOnly) args.push('--sale-only');
      if (!config.enableDiscovery) args.push('--no-discovery');
      // Always disable Shopify sync for scheduled scrapes
      args.push('--no-shopify-sync');

      const pythonProcess = spawn('python3', args, {
        cwd: scraperPath,
        env: {
          ...process.env,
          DB_NAME: 'tfs-db',
          MAX_PRODUCTS_PER_DAY: config.maxProductsPerDay?.toString() || '1000',
          EXCLUDED_BRANDS: config.excludedBrands ? JSON.stringify(config.excludedBrands) : '[]',
          SPECIFIC_BRANDS: config.specificBrands ? JSON.stringify(config.specificBrands) : '[]'
        }
      });

      // Track the process
      runningJobs.set(`scrape_${scheduledJob.id}`, pythonProcess);

      // Handle output
      pythonProcess.stdout.on('data', (data) => {
        console.log(`[Scheduled #${scheduledJob.id}] ${data.toString().trim()}`);
      });

      pythonProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output.includes('ERROR') || output.includes('WARNING') || output.includes('Traceback')) {
          console.error(`[Scheduled #${scheduledJob.id} ERROR] ${output}`);
        } else {
          console.log(`[Scheduled #${scheduledJob.id}] ${output}`);
        }
      });

      pythonProcess.on('close', (code) => {
        runningJobs.delete(`scrape_${scheduledJob.id}`);

        if (code === 0) {
          console.log(`✅ Scheduled job "${scheduledJob.name}" completed successfully`);
        } else if (code === null) {
          console.log(`⚠️  Scheduled job "${scheduledJob.name}" was terminated`);
        } else {
          console.error(`❌ Scheduled job "${scheduledJob.name}" failed with code ${code}`);
        }
      });

      pythonProcess.on('error', (error) => {
        console.error(`❌ Failed to start scheduled job "${scheduledJob.name}":`, error);
        runningJobs.delete(`scrape_${scheduledJob.id}`);
      });

    } catch (error) {
      console.error(`❌ Error executing scheduled scrape job:`, error);
    }
  }

  /**
   * Check for product creation jobs that need to run
   */
  async checkProductCreationJobs() {
    try {
      // Find the active product creation job that needs to run
      const [jobs] = await db.execute(
        `SELECT * FROM product_creation_jobs
         WHERE enabled = TRUE
         AND next_run_at <= NOW()
         AND status IN ('pending', 'completed')
         ORDER BY next_run_at ASC
         LIMIT 1`
      );

      if (jobs.length === 0) {
        return;
      }

      const job = jobs[0];

      // Skip if already running
      if (runningJobs.has(`product_creation_${job.id}`)) {
        console.log(`  ⏭️  Skipping product creation - already running`);
        return;
      }

      console.log(`  📦 Starting product creation job (max ${job.max_products_per_run} products)`);
      await this.executeProductCreationJob(job);
    } catch (error) {
      console.error('❌ Error checking product creation jobs:', error);
    }
  }

  /**
   * Execute product creation job
   * TODO: This needs to be implemented with actual product creation logic
   */
  async executeProductCreationJob(job) {
    try {
      // Calculate next run time
      const nextRunAt = new Date();
      nextRunAt.setHours(nextRunAt.getHours() + job.schedule_interval);

      // Create a new job entry for this run
      const [result] = await db.execute(
        `INSERT INTO product_creation_jobs (
          shop_id,
          max_products_per_run,
          schedule_interval,
          max_wheels_per_run,
          max_tires_per_run,
          enabled,
          status,
          started_at,
          next_run_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'running', NOW(), ?)`,
        [
          job.shop_id,
          job.max_products_per_run,
          job.schedule_interval,
          job.max_wheels_per_run,
          job.max_tires_per_run,
          job.enabled,
          nextRunAt
        ]
      );

      const newJobId = result.insertId;

      console.log(`  ✅ Created product creation job #${newJobId}`);
      console.log(`  ⏰ Next run scheduled for: ${nextRunAt.toISOString()}`);

      // Mark the process as running
      runningJobs.set(`product_creation_${job.id}`, true);

      // TODO: Spawn product creation worker here
      // For now, just mark as completed
      setTimeout(async () => {
        await db.execute(
          `UPDATE product_creation_jobs
           SET status = 'completed',
               completed_at = NOW(),
               products_created = 0,
               wheels_created = 0,
               tires_created = 0
           WHERE id = ?`,
          [newJobId]
        );

        runningJobs.delete(`product_creation_${job.id}`);
        console.log(`✅ Product creation job #${newJobId} completed (placeholder)`);
      }, 5000);

    } catch (error) {
      console.error('❌ Error executing product creation job:', error);
    }
  }
}

// Export singleton instance
export const jobScheduler = new JobScheduler();

export default jobScheduler;
