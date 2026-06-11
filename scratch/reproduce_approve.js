const { createClient } = require('@supabase/supabase-js');

const url = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(url, key);

// 森田さんの情報
const moritaStaffId = '1cebadfb-1cb7-46a3-9780-f37de5f93590';
const moritaUserId = 'd03aef86-ff78-4467-97be-9d2b8b57a206';

async function main() {
  const reqId = `test-morita-hours-${Date.now()}`;
  const now = new Date().toISOString();

  // 1. requests テーブルに「時間休」の申請を挿入してみる
  console.log('Inserting request...');
  const { data: rData, error: rErr } = await supabase.from('requests').insert([
    {
      id: reqId,
      staff_id: moritaStaffId,
      user_id: moritaUserId,
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

  if (rErr) {
    console.error('Insert Request Error:', rErr);
    return;
  }
  console.log('Insert Request Success:', rData);

  // 2. 承認処理を模倣（statusをapprovedにしてupsert）
  console.log('Updating request to approved...');
  const { data: uData, error: uErr } = await supabase.from('requests')
    .update({ status: 'approved' })
    .eq('id', reqId)
    .select();

  if (uErr) {
    console.error('Update Request Status Error:', uErr);
    return;
  }
  console.log('Update Request Status Success:', uData);

  // 3. shifts テーブルへのマッピングと upsert を模倣
  console.log('Upserting to shifts...');
  const { data: sData, error: sErr } = await supabase.from('shifts').upsert([
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

  if (sErr) {
    console.error('Upsert Shift Error:', sErr);
    return;
  }
  console.log('Upsert Shift Success:', sData);

  // クリーンアップ
  console.log('Cleaning up...');
  await supabase.from('requests').delete().eq('id', reqId);
  await supabase.from('shifts').delete().eq('id', reqId);
  console.log('Done.');
}

main();
