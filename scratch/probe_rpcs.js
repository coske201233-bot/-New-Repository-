const fetch = require('node-fetch');

const url = 'https://nizhtuzqmtlgfqmxpybb.supabase.co/rest/v1/rpc/';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const functionNames = [
  'exec_sql', 'run_sql', 'execute_sql', 'sql', 'query', 'exec', 
  'exec_query', 'execute_query', 'run', 'execute', 'run_query', 
  'sql_exec', 'sql_query', 'db_query', 'admin_query', 'admin_sql',
  'bypass_sql', 'force_sql', 'migrate_sql', 'migrate_db', 'run_migrations'
];

async function main() {
  for (const name of functionNames) {
    try {
      const res = await fetch(`${url}${name}`, {
        method: 'GET',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`
        }
      });
      // 405 means the endpoint exists (POST is required), 404 means it doesn't exist.
      console.log(`RPC ${name}: status = ${res.status}`);
      if (res.status !== 404) {
        console.log(`-> RPC ${name} EXISTS! Status: ${res.status}`);
      }
    } catch (err) {
      console.error(`Error probing ${name}:`, err.message);
    }
  }
}

main();
