
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function lockEverything() {
  console.log('--- LOCKING CURRENT SCHEDULE ---');
  const { data: requests, error } = await supabase.from('requests').select('*');
  if (error) { console.error(error); return; }

  console.log(`Processing ${requests.length} records...`);
  for (let i = 0; i < requests.length; i += 20) {
    const chunk = requests.slice(i, i + 20);
    const updates = chunk.map(r => {
      const currentDetails = r.details || {};
      return supabase.from('requests').update({
        details: { ...currentDetails, locked: true, isManual: true }
      }).eq('id', r.id);
    });
    await Promise.all(updates);
    console.log(`Locked ${i + chunk.length} / ${requests.length}`);
  }
  console.log('Done. All current records are now locked/manual.');
}

lockEverything();
