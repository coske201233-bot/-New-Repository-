const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://nizhtuzqmtlgfqmxpybb.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  console.log("Probing staff.id...");
  const { data, error } = await supabase.from('staff').select('*').eq('id', 'not-a-uuid');
  console.log("staff.id query result:", { data, error: error?.message, code: error?.code });
}

main();
