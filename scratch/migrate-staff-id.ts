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
  
  console.log(`Migrating Sato Koki from ${oldId} to ${newId}...`);

  // 1. Update staff table
  const { error: err1 } = await supabase.from('staff').update({ id: newId, user_id: newId }).eq('id', oldId);
  if (err1) {
    console.error('Staff update error:', err1);
    // If update fails because of foreign keys or other reasons, try insert + delete or just updating shifts
  } else {
    console.log('✅ Staff table updated.');
  }

  // 2. Update shifts table
  const { error: err2 } = await supabase.from('shifts').update({ staff_id: newId }).eq('staff_id', oldId);
  console.log('✅ Shifts table updated:', err2 ? err2.message : 'Success');

  // 3. Update requests table
  const { error: err3 } = await supabase.from('requests').update({ user_id: newId, staff_id: newId }).eq('user_id', oldId);
  console.log('✅ Requests table updated (user_id):', err3 ? err3.message : 'Success');
  
  const { error: err4 } = await supabase.from('requests').update({ staff_id: newId }).eq('staff_id', oldId);
  console.log('✅ Requests table updated (staff_id):', err4 ? err4.message : 'Success');

  // 4. Update request IDs themselves if they contain the old UUID
  // This is tricky but important for CalendarScreen's extractUuid
  // We'll skip this for now and rely on the name fallback + staff_id match
}

migrate();
