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

async function deepMigrate() {
  const oldId = '70eb22b7-90a1-46b8-b120-0b9e67121e61';
  const newId = '902d91d7-3ae9-4b5e-8db3-a08f33c4ec7b';

  console.log('Fetching records with old ID in their primary key...');
  
  // 1. Shifts
  const { data: shifts } = await supabase.from('shifts').select('*').like('id', `%${oldId}%`);
  if (shifts && shifts.length > 0) {
    console.log(`Found ${shifts.length} shifts to migrate IDs.`);
    for (const s of shifts) {
      const newKey = s.id.replace(oldId, newId);
      // We have to delete and re-insert because ID is primary key
      const { error: delErr } = await supabase.from('shifts').delete().eq('id', s.id);
      if (!delErr) {
        const { error: insErr } = await supabase.from('shifts').insert({ ...s, id: newKey, staff_id: newId });
        if (insErr) console.error('Shift insert error:', insErr);
      }
    }
  }

  // 2. Requests
  const { data: reqs } = await supabase.from('requests').select('*').like('id', `%${oldId}%`);
  if (reqs && reqs.length > 0) {
    console.log(`Found ${reqs.length} requests to migrate IDs.`);
    for (const r of reqs) {
      const newKey = r.id.replace(oldId, newId);
      const { error: delErr } = await supabase.from('requests').delete().eq('id', r.id);
      if (!delErr) {
        const { error: insErr } = await supabase.from('requests').insert({ ...r, id: newKey, user_id: newId });
        if (insErr) console.error('Request insert error:', insErr);
      }
    }
  }

  console.log('✅ Deep migration complete.');
}

deepMigrate();
