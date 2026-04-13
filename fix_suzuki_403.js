const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixSuzukiShift() {
  console.log('鈴木の4月3日の時間給を修正中...');

  const date = '2026-04-03';
  const staffName = '鈴木';

  // 1. Supabaseの更新
  // 既存のエントリ（タイプを問わず）を削除
  await supabase.from('requests').delete().eq('staff_name', staffName).eq('date', date);

  // 「時間給2」として新規登録（マニュアル・固定扱い）
  await supabase.from('requests').insert({
    id: `m-鈴木-${date}-fixed-hourly`,
    staff_name: staffName,
    date: date,
    type: '時間給2',
    status: 'approved',
    details: { 
      note: '確定（保持）', 
      isManual: true, 
      locked: true,
      duration: 2 // 「時間給2」に合わせ、念のため時間も2に設定
    },
    created_at: new Date().toISOString()
  });

  console.log('Supabase: 4/3 を「時間給2」で固定しました。');

  // 2. ローカルダンプの更新
  let data = JSON.parse(fs.readFileSync('requests_dump.json', 'utf8'));
  data = data.filter(item => !(item.staff_name === staffName && item.date === date));
  
  data.push({
    id: `m-鈴木-${date}-fixed-hourly`,
    staff_name: staffName,
    date: date,
    type: '時間給2',
    status: 'approved',
    details: { 
      note: '確定（保持）', 
      isManual: true, 
      locked: true,
      duration: 2
    },
    created_at: new Date().toISOString()
  });

  fs.writeFileSync('requests_dump.json', JSON.stringify(data, null, 1));
  console.log('requests_dump.json を更新しました。');
}

fixSuzukiShift();
