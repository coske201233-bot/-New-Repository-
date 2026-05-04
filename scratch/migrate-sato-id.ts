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

async function migrate() {
  const oldId = '70eb22b7-90a1-46b8-b120-0b9e67121e61';
  const newId = '902d91d7-3ae9-4b5e-8db3-a08f33c4ec7b';

  console.log(`--- Migrating ID ${oldId} to ${newId} ---`);

  // 1. Update shifts table
  const { count: sCount, error: sErr } = await supabase
    .from('shifts')
    .update({ staff_id: newId })
    .eq('staff_id', oldId);
    
  if (sErr) console.error('Shifts migration error:', sErr);
  else console.log(`Updated shifts records.`);

  // 2. Update requests table
  const { count: rCount, error: rErr } = await supabase
    .from('requests')
    .update({ user_id: newId })
    .eq('user_id', oldId);

  if (rErr) console.error('Requests migration error:', rErr);
  else console.log(`Updated requests records.`);

  console.log('Migration complete.');
}

migrate();
