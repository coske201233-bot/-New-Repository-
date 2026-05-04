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

async function restore() {
  console.log('--- Restoring Sato (7316...) ---');
  const { error } = await supabase.from('staff').insert({
    id: '7316601e-6d95-469a-b920-3cbf84087bd8',
    name: '佐藤',
    placement: '２F',
    profession: 'PT',
    position: 'スタッフ',
    role: 'スタッフ',
    status: '常勤',
    is_approved: true
  });
  
  if (error) {
    console.error('Restore error:', error);
  } else {
    console.log('Successfully restored Sato record.');
  }
}

restore();
