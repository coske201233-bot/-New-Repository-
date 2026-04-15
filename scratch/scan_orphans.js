const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

async function scanOrphans() {
  const { data: staff } = await supabase.from('staff').select('name');
  const { data: reqs } = await supabase.from('requests').select('staff_name, id');
  
  const staffNames = new Set(staff.map(s => s.name));
  const orphans = {};
  
  reqs.forEach(r => {
    if (!staffNames.has(r.staff_name)) {
      orphans[r.staff_name] = (orphans[r.staff_name] || 0) + 1;
    }
  });
  
  console.log('Orphaned requests found:');
  console.log(JSON.stringify(orphans, null, 2));
}

scanOrphans();
