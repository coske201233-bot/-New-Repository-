const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function restoreData() {
  console.log('Restoring data for April - June 2026...');
  
  // 4月から6月の削除済みデータを取得して「approved」に戻す
  const { data, error } = await supabase
    .from('requests')
    .update({ status: 'approved' })
    .eq('status', 'deleted')
    .gte('date', '2026-04-01')
    .lte('date', '2026-06-30')
    .select();

  if (error) {
    console.error('Error restoring data:', error);
  } else {
    console.log(`Successfully restored ${data ? data.length : 0} records.`);
    if (data && data.length > 0) {
      data.forEach(r => console.log(`  Restored: [${r.date}] ${r.staff_name} - ${r.type}`));
    }
  }
}

restoreData();
