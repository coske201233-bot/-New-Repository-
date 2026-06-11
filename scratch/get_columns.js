const { createClient } = require('@supabase/supabase-js');

const url = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(url, key);

async function main() {
  try {
    const { data: reqs, error: rErr } = await supabase.from('requests').select('*').limit(5);
    if (rErr) throw rErr;
    console.log('--- Requests Sample ---');
    console.log(reqs[0] || 'No data');

    const { data: shifts, error: sErr } = await supabase.from('shifts').select('*').limit(5);
    if (sErr) throw sErr;
    console.log('--- Shifts Sample ---');
    console.log(shifts[0] || 'No data');
  } catch (err) {
    console.error(err);
  }
}

main();
