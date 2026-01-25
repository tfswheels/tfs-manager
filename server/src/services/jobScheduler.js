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
      if (config.saleOnly) args.push('--sale-only');
      if (config.useZenrows === false) args.push('--no-zenrows');

      const pythonProcess = spawn('python3', args, {
        cwd: scraperPath,
        env: {
          ...process.env,
          DB_NAME: 'tfs-db',
          MAX_PRODUCTS_PER_DAY: config.maxProductsPerDay?.toString() || '1000',
          EXCLUDED_BRANDS: config.excludedBrands ? JSON.stringify(config.excludedBrands) : '[]',
          SPECIFIC_BRANDS: config.specificBrands ? JSON.stringify(config.specificBrands) : '[]',
          BACKORDER_COUNT: config.backorderCount?.toString() || '5'
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
   * Only creates jobs based on:
   * 1. Time elapsed since last COMPLETED job (not next_run_at field)
   * 2. Schedule interval from most recent config
   */
  async checkProductCreationJobs() {
    try {
      // Get all shops to check their product creation schedules
      const [shops] = await db.execute('SELECT id FROM shops');

      for (const shop of shops) {
        const shopId = shop.id;

        // Get the most recent job (for configuration settings)
        const [configs] = await db.execute(
          `SELECT * FROM product_creation_jobs
           WHERE shop_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [shopId]
        );

        if (configs.length === 0 || !configs[0].enabled) {
          continue; // No config or disabled
        }

        const config = configs[0];

        // Find the last COMPLETED job for this shop
        const [lastCompletedJobs] = await db.execute(
          `SELECT completed_at, id FROM product_creation_jobs
           WHERE shop_id = ?
           AND status = 'completed'
           ORDER BY completed_at DESC
           LIMIT 1`,
          [shopId]
        );

        // Calculate if it's time to run
        const now = new Date();
        let shouldRun = false;

        if (lastCompletedJobs.length === 0) {
          // No completed jobs yet - run now if enabled
          shouldRun = true;
          console.log(`  📦 No completed jobs yet - will start first run`);
        } else {
          const lastCompletedAt = new Date(lastCompletedJobs[0].completed_at);
          const scheduleIntervalMs = (config.schedule_interval || 24) * 60 * 60 * 1000; // hours to ms
          const nextRunTime = new Date(lastCompletedAt.getTime() + scheduleIntervalMs);

          if (now >= nextRunTime) {
            shouldRun = true;
            const hoursSinceLastRun = Math.floor((now - lastCompletedAt) / (1000 * 60 * 60));
            console.log(`  📦 Last run completed ${hoursSinceLastRun} hours ago - time for next run`);
          }
        }

        if (!shouldRun) {
          continue;
        }

        // Check if there's already a running job
        const [runningJobs] = await db.execute(
          `SELECT id FROM product_creation_jobs
           WHERE shop_id = ?
           AND status = 'running'
           LIMIT 1`,
          [shopId]
        );

        if (runningJobs.length > 0) {
          console.log(`  ⏭️  Skipping product creation - job #${runningJobs[0].id} already running`);
          continue;
        }

        console.log(`  📦 Starting scheduled product creation job (max ${config.max_products_per_run} products)`);
        await this.executeProductCreationJob(config, shopId);
      }
    } catch (error) {
      console.error('❌ Error checking product creation jobs:', error);
    }
  }

  /**
   * Execute product creation job
   * Spawns the Python product creation worker
   *
   * @param {Object} config - Configuration from most recent job
   * @param {number} shopId - Shop ID
   */
  async executeProductCreationJob(config, shopId) {
    try {
      // Calculate next run time (for display purposes only)
      const nextRunAt = new Date();
      nextRunAt.setHours(nextRunAt.getHours() + (config.schedule_interval || 24));

      // Create a new job entry for this execution (for history tracking)
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
          shopId,
          config.max_products_per_run,
          config.schedule_interval,
          config.max_wheels_per_run,
          config.max_tires_per_run,
          config.enabled,
          nextRunAt
        ]
      );

      const newJobId = result.insertId;

      console.log(`  ✅ Created product creation job #${newJobId}`);
      console.log(`  ⏰ Next scheduled run: ${nextRunAt.toISOString()}`);

      // Spawn Python product creation worker
      const workerPath = path.join(__dirname, '../../workers/product-creator');
      const pythonScript = path.join(workerPath, 'create_shopify_products.py');

      const args = [
        pythonScript,
        `--job-id=${newJobId}`,
        `--max-products=${config.max_products_per_run || 1000}`
      ];

      console.log(`  📦 Spawning Python worker...`);
      console.log(`  📂 Working directory: ${workerPath}`);
      console.log(`  🐍 Python script: ${pythonScript}`);
      console.log(`  📋 Arguments: ${JSON.stringify(args)}`);

      const pythonProcess = spawn('python3', args, {
        cwd: workerPath,
        env: {
          ...process.env,
          DB_NAME: 'tfs-manager'
        }
      });

      console.log(`  ✅ Python process spawned with PID: ${pythonProcess.pid}`);

      // Track the process by newJobId (not config.id)
      runningJobs.set(`product_creation_${newJobId}`, pythonProcess);

      // Handle output
      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        console.log(`[Product Creation #${newJobId} STDOUT] ${output}`);
      });

      pythonProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        console.log(`[Product Creation #${newJobId} STDERR] ${output}`);
        if (output.includes('ERROR') || output.includes('WARNING') || output.includes('Traceback')) {
          console.error(`[Product Creation #${newJobId} ⚠️  ERROR] ${output}`);
        }
      });

      pythonProcess.on('error', (error) => {
        console.error(`[Product Creation #${newJobId}] ❌ Process error:`, error);
        runningJobs.delete(`product_creation_${newJobId}`);
      });

      pythonProcess.on('close', (code) => {
        runningJobs.delete(`product_creation_${newJobId}`);

        if (code === 0) {
          console.log(`✅ Product creation job #${newJobId} completed successfully`);
        } else if (code === null) {
          console.log(`⚠️  Product creation job #${newJobId} was terminated`);
        } else {
          console.error(`❌ Product creation job #${newJobId} failed with exit code ${code}`);
        }
      });

    } catch (error) {
      console.error('❌ Error executing product creation job:', error);
    }
  }
}

// Export singleton instance
export const jobScheduler = new JobScheduler();

export default jobScheduler;
