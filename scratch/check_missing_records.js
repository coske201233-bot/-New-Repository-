const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMissingRecords() {
  const targets = [
    { name: 'SATOKOKI', date: '2026-04-11' },
    { name: 'SAKASITA', date: '2026-05-04' },
    { name: 'NAKANO', date: '2026-05-05' }
  ];

  console.log('--- Checking for missing records ---');

  for (const t of targets) {
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('date', t.date);
    
    if (error) {
      console.error(`Error fetching for ${t.date}:`, error);
      continue;
    }

    console.log(`\nDate: ${t.date}`);
    const matches = data.filter(r => 
      r.staff_name.toUpperCase().includes(t.name) || 
      t.name.includes(r.staff_name.toUpperCase())
    );

    if (matches.length > 0) {
      matches.forEach(m => {
        console.log(`✅ Found: ID=${m.id}, Name=${m.staff_name}, Status=${m.status}, Type=${m.type}`);
      });
    } else {
      console.log(`❌ Not found in DB with name like "${t.name}"`);
      console.log(`   (Other names on this date: ${data.map(r => r.staff_name).join(', ') || 'NONE'})`);
    }
  }
}

checkMissingRecords();
