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

async function merge() {
  console.log('--- Merging Sato (7316...) into Sato Koki (902d...) ---');
  
  // 1. Delete the duplicate "佐藤" record
  const { error: delError } = await supabase
    .from('staff')
    .delete()
    .eq('id', '7316601e-6d95-469a-b920-3cbf84087bd8');
    
  if (delError) {
    console.error('Delete error:', delError);
  } else {
    console.log('Deleted duplicate Sato record (7316...)');
  }

  // 2. Ensure Sato Koki has the correct name
  const { error: upError } = await supabase
    .from('staff')
    .update({ name: '佐藤公貴' })
    .eq('id', '902d91d7-3ae9-4b5e-8db3-a08f33c4ec7b');

  if (upError) {
    console.error('Update error:', upError);
  } else {
    console.log('Confirmed Sato Koki name is correct.');
  }
}

merge();
