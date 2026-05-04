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
  const { data, error } = await supabase.from('staff').select('*').eq('name', '佐藤公貴');
  if (error) {
    console.error(error);
    return;
  }
  
  if (data && data.length > 0) {
    console.log('Sato Koki record:', JSON.stringify(data[0], null, 2));
  } else {
    console.log('Sato Koki not found in staff table.');
  }
}

check();
