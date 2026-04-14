
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const backup = JSON.parse(fs.readFileSync('requests_dump.json', 'utf8'));

async function restore() {
  console.log('--- RESTORING APRIL & MAY ---');
  
  // 1. Wipe current April & May records
  console.log('Wiping existing April & May records...');
  const { error: wipeError } = await supabase
    .from('requests')
    .delete()
    .gte('date', '2026-04-01')
    .lte('date', '2026-05-31');

  if (wipeError) {
    console.error('Wipe error:', wipeError);
    return;
  }

  // 2. Filter backup for April & May
  const toRestore = backup.filter(r => r.date >= '2026-04-01' && r.date <= '2026-05-31');
  console.log(`Found ${toRestore.length} records in backup to restore.`);

  // 3. Batch insert
  const chunkSize = 50;
  for (let i = 0; i < toRestore.length; i += chunkSize) {
    const chunk = toRestore.slice(i, i + chunkSize);
    // Remove id to avoid primary key conflicts if any? 
    // Actually, we wiped them, so we should use the same IDs if possible.
    // Wait, some IDs in backup might have been generated on the fly.
    const cleanChunk = chunk.map(r => {
      return {
        id: r.id,
        staff_name: r.staff_name,
        date: r.date,
        type: r.type,
        status: r.status,
        details: r.details,
        reason: r.reason,
        created_at: r.created_at
      };
    });

    const { error: insertError } = await supabase
      .from('requests')
      .insert(cleanChunk);

    if (insertError) {
      console.error(`Insert error at chunk ${i}:`, insertError);
    } else {
      console.log(`Restored ${i + cleanChunk.length} / ${toRestore.length}`);
    }
  }
  console.log('Restoration complete.');
}

restore();
