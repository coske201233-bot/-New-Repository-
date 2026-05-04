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
  const { data, error } = await supabase.from('shifts').select('staff_name, staff_id').limit(100);
  if (error) {
    console.error(error);
    return;
  }
  
  console.log('Total checked:', data.length);
  const missing = data.filter(s => !s.staff_id);
  console.log('Missing staff_id:', missing.length);
  if (missing.length > 0) {
    console.log('Sample missing names:', missing.slice(0, 5).map(m => m.staff_name));
  }
}

check();
