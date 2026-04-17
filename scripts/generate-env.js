const fs = require('fs');
const path = require('path');

// Vercel上の環境変数を取得
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Error: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is not defined in environment variables.');
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
