const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://nizhtuzqmtlgfqmxpybb.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const tables = ['requests', 'shifts', 'staff'];
  for (const table of tables) {
    console.log(`--- Fetching from: ${table} ---`);
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.error(`Error fetching from ${table}:`, error);
    } else {
      console.log(`Data for ${table}:`, data);
      if (data && data.length > 0) {
        const row = data[0];
        const types = {};
        for (const k in row) {
          types[k] = {
            value: row[k],
            jsType: typeof row[k]
          };
        }
        console.log(`Column details for ${table}:`, types);
      } else {
        console.log(`No records found in ${table}.`);
      }
    }
  }
}

main();
