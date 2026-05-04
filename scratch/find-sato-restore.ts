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

async function find() {
  // Look for any info in shifts for this ID
  const { data, error } = await supabase.from('shifts').select('*').eq('staff_id', '7316601e-6d95-469a-b920-3cbf84087bd8').limit(1);
  if (data && data.length > 0) {
    console.log('Found Sato details:', JSON.stringify(data[0], null, 2));
  } else {
    // Try requests
    const { data: rData } = await supabase.from('requests').select('*').eq('staff_name', '佐藤').limit(1);
    console.log('Found Sato in requests:', JSON.stringify(rData?.[0], null, 2));
  }
}

find();
