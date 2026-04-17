import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

// デバッグ用：現在認識されている環境変数のキーをすべて表示（値は伏せる）
if (typeof window !== 'undefined') {
  const envKeys = Object.keys(process.env).filter(k => k.includes('SUPABASE') || k.includes('EXPO') || k.includes('VITE'));
  console.log('🔍 [DEBUG] Current available env keys:', envKeys);
}

// 📌 Vercelデプロイ救済策：ビルド時に環境変数が注入されない場合でも、
// 以前に設定された有効な接続情報を予備（Fallback）として使用します。
const FALLBACK_URL = "https://nizhtuzqmtlgfqmxpybb.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y";

const supabaseUrl = 
  process.env.EXPO_PUBLIC_SUPABASE_URL || 
  process.env.VITE_SUPABASE_URL || 
  process.env.NEXT_PUBLIC_SUPABASE_URL || 
  process.env.SUPABASE_URL || 
  FALLBACK_URL;

const supabaseAnonKey = 
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 
  process.env.VITE_SUPABASE_ANON_KEY || 
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
  process.env.SUPABASE_ANON_KEY || 
  FALLBACK_KEY;

// 接続情報のバリデーション（URL形式チェック）
const isValid = (supabaseUrl && supabaseUrl.startsWith('http'));

if (!isValid) {
  console.error('❌ [CRITICAL CONFIG ERROR] Supabase configuration is invalid even with fallbacks.');
}

// 常に設定済みとして扱う（ハードコードされた予備があるため）
export const isSupabaseConfigured = true;

// Supabase クライアントの作成
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});

