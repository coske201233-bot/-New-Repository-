const fs = require('fs');
const path = require('path');

// Vercel上の環境変数を取得、なければ.env.local / .env から取得を試みる
let supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
let supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8') || fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const urlMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_URL=["']?(.+?)["']?(\s|$)/);
    const keyMatch = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=["']?(.+?)["']?(\s|$)/);
    if (urlMatch) supabaseUrl = urlMatch[1];
    if (keyMatch) supabaseAnonKey = keyMatch[1];
  } catch (e) {
    // 読み込み失敗は無視（環境変数に期待）
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Error: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is not defined in environment variables or .env.local.');
  console.log('Available env vars:', Object.keys(process.env).filter(key => key.startsWith('EXPO_PUBLIC')));
  process.exit(1);
}

const envContent = `EXPO_PUBLIC_SUPABASE_URL=${supabaseUrl}
EXPO_PUBLIC_SUPABASE_ANON_KEY=${supabaseAnonKey}
`;

try {
  fs.writeFileSync(path.join(__dirname, '..', '.env.local'), envContent);
  console.log('✅ Successfully generated .env.local with Supabase credentials.');
} catch (error) {
  console.error('❌ Failed to write .env.local:', error);
  process.exit(1);
}
