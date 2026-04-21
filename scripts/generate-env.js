const fs = require('fs');
const path = require('path');

// Vercel上の環境変数を取得、なければ.env.local / .env から取得を試みる
let supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
let supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  try {
    const envFile = 
      (fs.existsSync(path.join(__dirname, '..', '.env.local')) && fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')) || 
      (fs.existsSync(path.join(__dirname, '..', '.env')) && fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'));
    
    if (envFile) {
      const urlMatch = envFile.match(/(?:EXPO_PUBLIC_|VITE_)?SUPABASE_URL=["']?(.+?)["']?(?:\s|$)/);
      const keyMatch = envFile.match(/(?:EXPO_PUBLIC_|VITE_)?SUPABASE_ANON_KEY=["']?(.+?)["']?(?:\s|$)/);
      if (urlMatch) supabaseUrl = urlMatch[1];
      if (keyMatch) supabaseAnonKey = keyMatch[1];
    }
  } catch (e) {
    // 読み込み失敗は無視
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Warning: Supabase credentials not found. Building with Safe Mode stubs.');
}

// 1. .env.local の生成（Expo/Vite の標準的な読み込み用）
const envContent = `VITE_SUPABASE_URL=${supabaseUrl || ""}
VITE_SUPABASE_ANON_KEY=${supabaseAnonKey || ""}
`;

// 2. env-config.json の生成（WSOD回避のための直接インポート用）
const configJson = {
  VITE_SUPABASE_URL: supabaseUrl || "",
  VITE_SUPABASE_ANON_KEY: supabaseAnonKey || ""
};

try {
  fs.writeFileSync(path.join(__dirname, '..', '.env.local'), envContent);
  console.log('✅ Generated .env.local');

  const utilsDir = path.join(__dirname, '..', 'src', 'utils');
  if (!fs.existsSync(utilsDir)) {
    fs.mkdirSync(utilsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(utilsDir, 'env-config.json'), JSON.stringify(configJson, null, 2));
  console.log('✅ Generated src/utils/env-config.json');
} catch (error) {
  console.error('❌ Failed to write configuration files:', error);
  process.exit(1);
}
