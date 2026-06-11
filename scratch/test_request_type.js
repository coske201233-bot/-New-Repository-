const { createClient } = require('@supabase/supabase-js');

const url = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(url, key);

async function main() {
  const reqId = `test-morita-req-type-${Date.now()}`;
  const now = new Date().toISOString();

  console.log('Inserting to requests with staff_id as "morita" (non-UUID)...');
  const { data, error } = await supabase.from('requests').insert([
    {
      id: reqId,
      staff_id: 'morita', // non-UUID
      user_id: 'morita',  // non-UUID
      staff_name: '森田',
      date: '2026-06-12',
      type: '時間休',
      status: 'pending',
      hours: 1.0,
      reason: 'テスト申請',
      details: { isManual: true, updatedAt: now },
      created_at: now
    }
  ]).select();

  if (error) {
    console.error('Insert Request Error:', error);
  } else {
    console.log('Insert Request Success:', data);
    await supabase.from('requests').delete().eq('id', reqId);
  }
}

main();
