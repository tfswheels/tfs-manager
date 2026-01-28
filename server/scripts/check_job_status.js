import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function checkJobs() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log('\n=== Recent Product Creation Jobs ===\n');
    const [jobs] = await connection.execute(`
      SELECT id, status, started_at, completed_at, next_run_at,
             products_created, schedule_interval, created_at
      FROM product_creation_jobs
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.table(jobs);

    console.log('\n=== Daily Creation Limit ===\n');
    const [limits] = await connection.execute(`
      SELECT date, total_created, wheels_created, tires_created, limit_per_day
      FROM daily_shopify_creation_limit
      ORDER BY date DESC
      LIMIT 5
    `);

    console.table(limits);

  } finally {
    await connection.end();
  }
}

checkJobs().catch(console.error);
