const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://nizhtuzqmtlgfqmxpybb.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const rpcNames = ['exec_sql', 'run_sql', 'execute_sql', 'sql', 'query', 'exec'];
  for (const name of rpcNames) {
    console.log(`Testing RPC function: ${name}`);
    try {
      const { data, error } = await supabase.rpc(name, { query: 'SELECT 1;' });
      if (error) {
        console.log(`RPC ${name} returned error:`, error.message || error);
      } else {
        console.log(`RPC ${name} succeeded! Data:`, data);
      }
    } catch (err) {
      console.log(`RPC ${name} threw exception:`, err.message || err);
    }
  }
}

main();
