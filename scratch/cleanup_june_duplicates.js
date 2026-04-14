
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
  console.log('Fetching June requests for cleanup...');
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .gte('date', '2026-06-01')
    .lte('date', '2026-06-30')
    .eq('status', 'approved');

  if (error) {
    console.error('Fetch error:', error);
    return;
  }

  const autoToDelete = data.filter(r => {
    const id = r.id || '';
    // m- や manual- で始まらない（自動生成）レコードを対象
    if (id.startsWith('m-') || id.startsWith('manual-')) return false;
    
    // 土日祝の割り当てを対象とする
    const d = new Date(r.date.replace(/-/g, '/'));
    const isSatSun = d.getDay() === 0 || d.getDay() === 6;
    
    // 祝日リスト（暫定）
    const pubHolidays = ['2026-06-01']; // 6月は祝日なし
    const isPub = pubHolidays.includes(r.date);
    
    return isSatSun || isPub;
  });

  console.log(`Found ${autoToDelete.length} auto-assigned holiday records to cleanup in June.`);
  
  for(const r of autoToDelete) {
    const { error: delErr } = await supabase
      .from('requests')
      .update({ status: 'deleted' })
      .eq('id', r.id);
    if (delErr) console.error(`Failed to delete ${r.id}:`, delErr);
    else console.log(`Soft-deleted ${r.id} (${r.staff_name} - ${r.date})`);
  }

  console.log('Cleanup complete.');
}

cleanup();
