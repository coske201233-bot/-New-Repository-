const { createClient } = require('@supabase/supabase-client');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAbeRequests() {
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .or('staffName.ilike.ABE,details->>staffName.ilike.ABE');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${data.length} requests for ABE`);
  data.forEach(r => {
    console.log(`${r.date}: ${r.type} (Status: ${r.status}, ID: ${r.id}, UpdatedAt: ${r.updatedAt || r.updated_at})`);
  });
  
  const dates = ['2026-05-18', '2026-05-22', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-18', '2026-06-19', '2026-06-22', '2026-06-23', '2026-06-30'];
  console.log('\nChecking target dates:');
  dates.forEach(d => {
    const match = data.filter(r => r.date === d);
    if (match.length > 0) {
      console.log(`[OK] ${d} has ${match.length} records`);
    } else {
      console.log(`[MISSING] ${d} has NO records in DB`);
    }
  });
}

checkAbeRequests();
