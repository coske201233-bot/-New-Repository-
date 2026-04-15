const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

async function deepAnalyze() {
  console.log('--- Phase 1: Staff Entry Analysis ---');
  const { data: staff, error: staffError } = await supabase.from('staff').select('*');
  if (staffError) { console.error(staffError); return; }
  
  const satokokiEntries = staff.filter(s => s.name.toUpperCase().includes('SATO'));
  console.log('Relevant Sato entries:');
  satokokiEntries.forEach(s => console.log(`ID: ${s.id}, Name: ${s.name}, Created: ${s.created_at}`));

  console.log('\n--- Phase 2: Request Analysis for 2026-04-11 ---');
  const { data: reqs, error: reqsError } = await supabase.from('requests').select('*').eq('date', '2026-04-11');
  if (reqsError) { console.error(reqsError); return; }
  
  console.log('Requests on 2026-04-11:');
  reqs.forEach(r => {
    console.log(`ID: ${r.id}, Name: "${r.staff_name}", Status: ${r.status}, Created: ${r.created_at}`);
  });

  console.log('\n--- Phase 3: Metadata check for write-locks/overwrites ---');
  // Look for multiple entries for the same person on same day with different names
  const allSatoReqs = await supabase.from('requests').select('*').ilike('staff_name', '%SATO%');
  console.log('Total Sato requests found:', allSatoReqs.data.length);
  const byDate = {};
  allSatoReqs.data.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  });
  
  for (const date in byDate) {
    if (byDate[date].length > 1) {
      console.log(`Potential conflict on ${date}:`, byDate[date].map(r => `"${r.staff_name}" (ID: ${r.id})`));
    }
  }
}

deepAnalyze();
