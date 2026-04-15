const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://xunmhyfivjtxidymvxyy.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('SUPABASE_ANON_KEY is missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStaff() {
  const { data, error } = await supabase.from('staff').select('name').limit(20);
  if (error) {
    console.error(error);
    return;
  }
  console.log('Current staff names in DB:');
  data.forEach(s => console.log(`- ${s.name}`));
}

checkStaff();
