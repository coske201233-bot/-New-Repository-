const { createClient } = require('@supabase/supabase-js');

const url = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(url, key);

async function main() {
  try {
    const { count: rCount, error: rErr } = await supabase.from('requests').select('*', { count: 'exact', head: true });
    if (rErr) throw rErr;
    console.log('Requests count:', rCount);

    const { count: sCount, error: sErr } = await supabase.from('shifts').select('*', { count: 'exact', head: true });
    if (sErr) throw sErr;
    console.log('Shifts count:', sCount);

    // Fetch actual 5 records if exists
    const { data: rData } = await supabase.from('requests').select('*').limit(5);
    console.log('Requests sample:', rData);
  } catch (err) {
    console.error(err);
  }
}

main();
