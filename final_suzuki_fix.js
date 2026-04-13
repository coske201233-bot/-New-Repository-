const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function finalSuzukiFix() {
  console.log('鈴木の4月3日の重複エントリを完全に削除し、「時間給2」に再固定します...');

  const date = '2026-04-03';
  const staffName = '鈴木';

  // 1. 全削除
  await supabase.from('requests').delete().eq('staff_name', staffName).eq('date', date);

  // 2. 新規挿入（最新のタイムスタンプで）
  const now = new Date().toISOString();
  await supabase.from('requests').insert({
    id: `m-鈴木-${date}-fixed-hourly-v2`,
    staff_name: staffName,
    date: date,
    type: '時間給2',
    status: 'approved',
    details: { 
      note: '最終確定（保持）', 
      isManual: true, 
      locked: true,
      duration: 2,
      updatedAt: now
    },
    updated_at: now,
    created_at: now
  });

  console.log('Supabase: 4/3 を「時間給2」で再固定完了。');

  // 3. ローカルダンプの更新
  let data = JSON.parse(fs.readFileSync('requests_dump.json', 'utf8'));
  data = data.filter(item => !(item.staff_name === staffName && item.date === date));
  data.push({
    id: `m-鈴木-${date}-fixed-hourly-v2`,
    staff_name: staffName,
    date: date,
    type: '時間給2',
    status: 'approved',
    details: { 
      note: '最終確定（保持）', 
      isManual: true, 
      locked: true,
      duration: 2,
      updatedAt: now
    },
    created_at: now,
    updated_at: now
  });

  fs.writeFileSync('requests_dump.json', JSON.stringify(data, null, 1));
  console.log('requests_dump.json も更新しました。');
}

finalSuzukiFix();
