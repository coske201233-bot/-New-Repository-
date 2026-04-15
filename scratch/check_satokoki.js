const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSpecific() {
  const staffName = 'SATOKOKI';
  const date = '2026-04-11';
  
  console.log(`--- Checking specifically for ${staffName} on ${date} ---`);
  
  // 1. By name
  const { data: byName } = await supabase.from('requests').select('*').eq('staff_name', staffName).eq('date', date);
  console.log('By Name "SATOKOKI":', byName.length, 'found');
  if (byName.length > 0) byName.forEach(r => console.log(`  ID: ${r.id}, Name: ${r.staff_name}, Status: ${r.status}`));

  // 2. By ID (assuming m-STAFFID-DATE format)
  const staffId = '1775085958034';
  const { data: byId } = await supabase.from('requests').select('*').eq('id', `m-${staffId}-${date}`);
  console.log(`By ID "m-${staffId}-${date}":`, byId.length, 'found');
  if (byId.length > 0) byId.forEach(r => console.log(`  ID: ${r.id}, Name: ${r.staff_name}, Status: ${r.status}`));

  // 3. By staff_id field
  const { data: byStaffIdField } = await supabase.from('requests').select('*').eq('staff_id', staffId).eq('date', date);
  console.log('By staff_id field:', byStaffIdField.length, 'found');
  if (byStaffIdField.length > 0) byStaffIdField.forEach(r => console.log(`  ID: ${r.id}, Name: ${r.staff_name}, Status: ${r.status}`));
}

checkSpecific();
