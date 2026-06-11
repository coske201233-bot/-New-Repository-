const { createClient } = require('@supabase/supabase-js');

const url = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(url, key);

async function main() {
  try {
    const { data: staff, error } = await supabase.from('staff').select('*').limit(100);
    if (error) throw error;
    console.log('--- Staff Count:', staff ? staff.length : 0);
    console.log('Sample Staff:', staff);
  } catch (err) {
    console.error(err);
  }
}

main();
