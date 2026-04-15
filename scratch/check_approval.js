const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkApproval() {
  const names = ['SATOKOKI', 'SAKASITA', 'NAKANO'];
  const { data, error } = await supabase.from('staff').select('*').in('name', names);
  if (error) { console.error(error); return; }
  data.forEach(s => {
    console.log(`Name: ${s.name}, isApproved: ${s.isApproved}, is_approved: ${s.is_approved}`);
  });
}

checkApproval();
