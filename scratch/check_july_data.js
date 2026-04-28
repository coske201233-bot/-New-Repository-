const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkJulyData() {
  const monthPrefix = '2026-07';
  
  // 1. Check Configs
  const { data: configs } = await supabase.from('app_config').select('*');
  const limits = configs.find(c => c.key === '@monthly_limits')?.value?.['2026-07'] || {};
  console.log('--- July 2026 Limits ---');
  console.log(limits);

  // 2. Check Requests
  const { data: requests } = await supabase
    .from('requests')
    .select('id, staff_name, date, type, status, details')
    .like('date', `${monthPrefix}%`);
  
  console.log(`\n--- July 2026 Requests Count: ${requests.length} ---`);
  
  const autoCount = requests.filter(r => String(r.id).startsWith('auto-') || String(r.id).startsWith('aw-') || String(r.id).startsWith('af-')).length;
  const manualCount = requests.length - autoCount;
  
  console.log(`Auto: ${autoCount}, Manual: ${manualCount}`);
  
  if (requests.length > 0) {
      console.log('\nSample Manual Requests:');
      console.log(requests.filter(r => !String(r.id).startsWith('auto-') && !String(r.id).startsWith('aw-') && !String(r.id).startsWith('af-')).slice(0, 5));
  }
}

checkJulyData();
