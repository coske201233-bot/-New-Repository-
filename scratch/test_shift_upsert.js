const { createClient } = require('@supabase/supabase-js');

const url = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(url, key);

const moritaStaffId = '1cebadfb-1cb7-46a3-9780-f37de5f93590';

async function main() {
  const reqId = `test-morita-shift-${Date.now()}`;
  const now = new Date().toISOString();

  console.log('Upserting to shifts...');
  const { data, error } = await supabase.from('shifts').upsert([
    {
      id: reqId,
      staff_id: moritaStaffId,
      staff_name: '森田',
      date: '2026-06-12',
      type: '時間休',
      status: 'approved',
      is_manual: true,
      hours: 1.0,
      details: { isManual: true, updatedAt: now }
    }
  ]).select();

  if (error) {
    console.error('Upsert Shift Error:', error);
  } else {
    console.log('Upsert Shift Success:', data);
    // クリーンアップ
    await supabase.from('shifts').delete().eq('id', reqId);
  }
}

main();
