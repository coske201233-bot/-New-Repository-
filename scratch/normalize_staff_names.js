
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

const normalize = (name) => {
  if (!name) return '';
  // 全角・半角スペース、特殊文字を削除。南條などの表記ゆれも修正。
  let n = name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');
  // 特定の短縮名を正式名称に
  if (n === '佐藤公') return '佐藤公貴';
  if (n === '藤森') return '藤森渓';
  if (n === '三井') return '三井諒';
  return n;
};

async function run() {
  console.log('--- Starting Staff Name Normalization ---');

  // 1. staffテーブルの修正
  const { data: staffList } = await supabase.from('staff').select('*');
  console.log(`Found ${staffList?.length} staff members.`);
  for (const s of staffList) {
    const originalName = s.name;
    const newName = normalize(originalName);
    if (originalName !== newName) {
      console.log(`Updating staff: [${originalName}] -> [${newName}]`);
      await supabase.from('staff').update({ name: newName }).eq('id', s.id);
    }
  }

  // 2. requestsテーブルの修正
  const { data: requests } = await supabase.from('requests').select('*');
  console.log(`Found ${requests?.length} request records.`);
  
  let updateCount = 0;
  for (const r of requests) {
    const originalName = r.staff_name;
    const newName = normalize(originalName);
    if (originalName !== newName) {
      updateCount++;
      if (updateCount % 50 === 0) console.log(`Processed ${updateCount} updates...`);
      await supabase.from('requests').update({ staff_name: newName }).eq('id', r.id);
    }
  }

  console.log(`Normalization complete. Total staff updated: ${staffList?.length}, Requests updated: ${updateCount}`);
}

run();
