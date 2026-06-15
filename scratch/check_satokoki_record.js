const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// 1. 環境変数から値を安全に取得
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

// 2. 特権クライアント用の Service Role Key を厳密に取得
const supabaseServiceKey = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

// 3. 曖昧さを排除した厳密な存在チェック
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase credentials missing: URLまたはService Role Keyが設定されていません。');
  // 💡 Web環境でのクラッシュを防ぐため、process.exit(1) ではなく警告を投げる形にして安全に処理を止めます
  throw new Error('Supabase credentials missing. Please check your Environment Variables.');
}

// 4. ここから下で、この supabaseServiceKey を使ってクライアントを初期化します
// export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, ...);
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
