const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStaffDetails() {
  const targets = ['SATOKOKI', 'SAKASITA', 'NAKANO'];
  const { data, error } = await supabase.from('staff').select('name, placement, profession, status');
  if (error) {
    console.error(error);
    return;
  }
  
  console.log('--- Staff Details ---');
  data.filter(s => targets.includes(s.name)).forEach(s => {
    console.log(`Name: ${s.name}, Placement: ${s.placement}, Profession: ${s.profession}, Status: ${s.status}`);
  });
}

checkStaffDetails();
