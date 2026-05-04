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
  const targetId = '902d91d7-3ae9-4b5e-8db3-a08f33c4ec7b';
  const { data, error } = await supabase.from('staff').select('*').eq('id', targetId);
  if (error) {
    console.error(error);
    return;
  }
  
  if (data && data.length > 0) {
    console.log('Staff found for', targetId, ':', data[0].name);
  } else {
    console.log('No staff found for', targetId);
    // 全件出してみる
    const { data: all } = await supabase.from('staff').select('id, name');
    console.log('Current staff list:');
    all?.forEach(s => console.log(`- ${s.name}: ${s.id}`));
  }
}

check();
