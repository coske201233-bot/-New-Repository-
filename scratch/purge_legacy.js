const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

async function purgeLegacyData() {
  console.log('--- Phase 1: Identifying target IDs from backup ---');
  if (!fs.existsSync('requests_backup_full.json')) {
      console.error('Backup file not found. Aborting.');
      return;
  }
  
  const backupData = JSON.parse(fs.readFileSync('requests_backup_full.json', 'utf8'));
  
  // Identify records that had Kanji in staff_name
  const kanjiTargetIds = backupData
    .filter(r => /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(r.staff_name))
    .map(r => r.id);
  
  console.log(`Found ${kanjiTargetIds.length} records that were originally Kanji.`);

  // Also include the Sato Akira records if they aren't already included
  const satoAkiraIds = backupData
    .filter(r => r.staff_name === '佐藤晃')
    .map(r => r.id);
  
  const allTargetIds = [...new Set([...kanjiTargetIds, ...satoAkiraIds])];
  console.log(`Total unique IDs to purge: ${allTargetIds.length}`);

  if (allTargetIds.length === 0) {
      console.log('No records found to purge.');
      return;
  }

  console.log('--- Phase 2: Executing Purge in Supabase ---');
  let deletedCount = 0;
  // Chunking for large deletions
  const chunkSize = 100;
  for (let i = 0; i < allTargetIds.length; i += chunkSize) {
    const chunk = allTargetIds.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from('requests')
      .delete()
      .in('id', chunk);
    
    if (error) {
      console.error(`Error deleting chunk ${i}:`, error);
    } else {
      deletedCount += chunk.length;
      process.stdout.write(`.`);
    }
  }

  console.log(`\nPurge complete. Total records deleted: ${deletedCount}`);
}

purgeLegacyData();
