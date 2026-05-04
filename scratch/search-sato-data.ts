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
  console.log('--- Checking shifts for "佐藤" ---');
  const { data: shifts, error: err1 } = await supabase.from('shifts').select('*').ilike('staff_name', '%佐藤%').limit(10);
  if (err1) console.error(err1);
  else console.log('Shifts found:', shifts.map(s => ({ id: s.id, name: s.staff_name, staff_id: s.staff_id })));

  console.log('\n--- Checking requests for "佐藤" ---');
  const { data: reqs, error: err2 } = await supabase.from('requests').select('*').ilike('staff_name', '%佐藤%').limit(10);
  if (err2) console.error(err2);
  else console.log('Requests found:', reqs.map(r => ({ id: r.id, name: r.staff_name, user_id: r.user_id })));
}

check();
