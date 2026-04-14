
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function wipeAutoJune() {
  console.log('Fetching all auto-requests for June...');
  const { data, error } = await supabase.from('requests').select('id, staff_name, date').gte('date', '2026-06-01').lte('date', '2026-06-30');
  if (error) { console.error(error); return; }

  const toDelete = data.filter(r => r.id.startsWith('auto-') || r.id.startsWith('af-') || r.id.startsWith('aw-') || r.id.startsWith('plan-')).map(r => r.id);
  console.log(`Deleting ${toDelete.length} auto-requests...`);

  for (let i = 0; i < toDelete.length; i += 50) {
    const { error: delError } = await supabase.from('requests').delete().in('id', toDelete.slice(i, i + 50));
    if (delError) console.error(delError);
  }
  console.log('Wipe complete.');
}

wipeAutoJune();
