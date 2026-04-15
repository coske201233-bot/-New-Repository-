const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

const normalizeName = (name) => {
  if (!name || typeof name !== 'string') return '';
  let n = name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '');
  n = n.replace(/條/g, '条').replace(/齊/g, '斉').replace(/齋/g, '斎');
  return n.toUpperCase();
};

async function executeMigration() {
  console.log('--- Step 1: Loading Data ---');
  const { data: staff } = await supabase.from('staff').select('*');
  const { data: reqs } = await supabase.from('requests').select('*');
  
  console.log(`Loaded ${staff.length} staff and ${reqs.length} requests.`);

  // Backup
  fs.writeFileSync('requests_backup_full.json', JSON.stringify(reqs, null, 2));
  console.log('Backup saved to requests_backup_full.json');

  const staffNormalMap = {};
  staff.forEach(s => {
    staffNormalMap[normalizeName(s.name)] = s;
  });

  const toDelete = [];
  const toUpdate = [];

  const orphans = [...new Set(reqs.map(r => r.staff_name).filter(name => !staff.some(s => s.name === name)))];
  
  for (const oldName of orphans) {
    const normalized = normalizeName(oldName);
    
    // Check if "佐藤晃" (explicitly requested to be deleted)
    if (oldName === '佐藤晃' || normalized === '佐藤晃') {
      console.log(`Marking "${oldName}" for deletion (as requested)`);
      const rIds = reqs.filter(r => r.staff_name === oldName).map(r => r.id);
      toDelete.push(...rIds);
      continue;
    }

    // Try to find a match in the current staff list using normalization
    const targetStaff = staffNormalMap[normalized];
    if (targetStaff) {
      console.log(`Mapping "${oldName}" -> "${targetStaff.name}"`);
      const rIds = reqs.filter(r => r.staff_name === oldName).map(r => r.id);
      toUpdate.push({ ids: rIds, newName: targetStaff.name, newId: targetStaff.id });
    } else {
      console.log(`No match for orphan: "${oldName}". Skipping for safety.`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`To Delete: ${toDelete.length} requests`);
  console.log(`To Update: ${toUpdate.length} groups of requests`);

  // Execution
  if (toDelete.length > 0) {
    console.log(`Executing deletion of ${toDelete.length} records...`);
    // Split into chunks of 100
    for (let i = 0; i < toDelete.length; i += 100) {
      const chunk = toDelete.slice(i, i + 100);
      const { error } = await supabase.from('requests').delete().in('id', chunk);
      if (error) console.error('Delete error:', error);
    }
  }

  for (const group of toUpdate) {
    console.log(`Updating ${group.ids.length} records to "${group.newName}"...`);
    for (let i = 0; i < group.ids.length; i += 100) {
      const chunk = group.ids.slice(i, i + 100);
      const { error } = await supabase.from('requests')
        .update({ staff_name: group.newName, staff_id: group.newId })
        .in('id', chunk);
      if (error) console.error('Update error:', error);
    }
  }

  console.log('\n--- Migration Complete ---');
}

executeMigration();
