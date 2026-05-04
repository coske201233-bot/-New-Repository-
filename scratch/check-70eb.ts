import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log('--- Searching for ID "70eb..." in historical data ---');
  
  const { data: sData, error: e1 } = await supabase.from('shifts').select('id, staff_id, staff_name').ilike('staff_id', '70eb%').limit(5);
  console.log('Shifts matching 70eb:', sData);

  const { data: rData, error: e2 } = await supabase.from('requests').select('id, user_id, staff_name').ilike('user_id', '70eb%').limit(5);
  console.log('Requests matching 70eb:', rData);
}

check();
