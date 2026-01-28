import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function testNextRunFix() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log('\n=== Testing Next Run Fix ===\n');
    console.log('This script verifies that next_run_at is calculated correctly.\n');

    // Get the most recent completed/terminated/failed job
    const [recentJobs] = await connection.execute(`
      SELECT id, status, started_at, completed_at, next_run_at, schedule_interval,
             TIMESTAMPDIFF(HOUR, started_at, completed_at) as duration_hours,
             TIMESTAMPDIFF(HOUR, completed_at, next_run_at) as hours_until_next
      FROM product_creation_jobs
      WHERE status IN ('completed', 'terminated', 'failed', 'cancelled')
      AND next_run_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 5
    `);

    if (recentJobs.length === 0) {
      console.log('⚠️  No jobs with next_run_at found yet.');
      console.log('   Run a job (even a quick manual termination) to test the fix.\n');
      return;
    }

    console.log('Recent jobs with next_run_at set:\n');

    for (const job of recentJobs) {
      const isCorrect = job.hours_until_next === job.schedule_interval;
      const status = isCorrect ? '✅' : '❌';

      console.log(`Job #${job.id} (${job.status})`);
      console.log(`  Started:              ${job.started_at}`);
      console.log(`  Completed:            ${job.completed_at}`);
      console.log(`  Duration:             ${job.duration_hours} hours`);
      console.log(`  Schedule Interval:    ${job.schedule_interval} hours`);
      console.log(`  Next Run:             ${job.next_run_at}`);
      console.log(`  Hours Until Next:     ${job.hours_until_next} hours`);
      console.log(`  ${status} Next run is ${job.hours_until_next} hours from COMPLETION (should be ${job.schedule_interval})\n`);
    }

    // Check if any jobs are still running
    const [runningJobs] = await connection.execute(`
      SELECT id, status, started_at, next_run_at
      FROM product_creation_jobs
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 3
    `);

    if (runningJobs.length > 0) {
      console.log('Currently running jobs (next_run_at should be NULL until they complete):\n');
      for (const job of runningJobs) {
        const hasNextRun = job.next_run_at !== null;
        const status = !hasNextRun ? '✅' : '❌';
        console.log(`Job #${job.id} - Started: ${job.started_at}`);
        console.log(`  ${status} next_run_at is ${job.next_run_at === null ? 'NULL' : job.next_run_at} (should be NULL while running)\n`);
      }
    }

    console.log('\n=== Summary ===');
    console.log('✅ = Fix is working correctly');
    console.log('❌ = Issue detected (next_run_at calculated from start instead of completion)');
    console.log('\nExpected behavior:');
    console.log('- Running jobs should have next_run_at = NULL');
    console.log('- Completed jobs should have next_run_at = completed_at + schedule_interval');
    console.log('- Next run timing should be from COMPLETION, not from START\n');

  } finally {
    await connection.end();
  }
}

testNextRunFix().catch(console.error);
