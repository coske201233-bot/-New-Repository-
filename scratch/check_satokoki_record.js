const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// 直接環境変数から取得できない場合のため、supabase.tsの値を想定して設定が必要かもしれません
// 現状は既存のツールやファイルから情報を得ます
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSpecificRecord() {
  console.log('--- Checking SATOKOKI on 2026-05-23 ---');
  
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .ilike('staff_name', '%SATOKOKI%')
    .eq('date', '2026-05-23');

  if (error) {
    console.error('Error fetching record:', error);
    return;
  }

  if (data.length === 0) {
    console.log('No record found for SATOKOKI on 2026-05-23');
  } else {
    console.log('Records found:', JSON.stringify(data, null, 2));
  }
}

checkSpecificRecord();
