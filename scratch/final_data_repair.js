
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function repair() {
  console.log('Starting data repair...');
  
  // 1. Fix Yoshida April 24 hours
  const { data: yoshida424 } = await supabase
    .from('requests')
    .select('*')
    .eq('staff_name', '吉田')
    .eq('date', '2026-04-24')
    .eq('status', 'approved');

  if (yoshida424 && yoshida424.length > 0) {
    for (const r of yoshida424) {
      if (r.id.startsWith('m-')) {
        const newDetails = { ...(r.details || {}), hours: 1.0, isManual: true, locked: true, updatedAt: new Date().toISOString() };
        const { error } = await supabase.from('requests').update({ details: newDetails }).eq('id', r.id);
        if (error) console.error('Error updating 4/24:', error);
        else console.log(`Fixed Yoshida 4/24 record ${r.id} (set hours to 1.0)`);
      }
    }
  }

  // 2. Fix Yoshida May 28 conflicts
  const { data: may28 } = await supabase
    .from('requests')
    .select('*')
    .eq('staff_name', '吉田')
    .eq('date', '2026-05-28')
    .neq('status', 'deleted');

  if (may28 && may28.length > 1) {
    console.log('Found multiple records for May 28. Cleaning up...');
    for (const r of may28) {
      if (r.id.startsWith('auto-')) {
        const { error } = await supabase.from('requests').update({ status: 'deleted' }).eq('id', r.id);
        if (error) console.error('Error deleting 5/28 zombie:', error);
        else console.log(`Soft-deleted zombie record ${r.id}`);
      }
    }
  }

  console.log('Repair complete.');
}

repair();
