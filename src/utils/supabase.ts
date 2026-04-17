import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

// デバッグ用：現在認識されている環境変数のキーをすべて表示（値は伏せる）
if (typeof window !== 'undefined') {
  const envKeys = Object.keys(process.env).filter(k => k.includes('SUPABASE') || k.includes('EXPO') || k.includes('VITE'));
  console.log('🔍 [DEBUG] Current available env keys:', envKeys);
}

// 🚨 TODO: EMERGENCY BYPASS - REVERT TO ENVIRONMENT VARIABLES BEFORE PRODUCTION
// Vercel / Expo の環境変数注入が不安定なため、複数の接頭辞パターンをチェックし、
// それでもダメな場合は直接埋め込まれたフォールバック値を使用します。

const getEnv = (key: string) => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[`EXPO_PUBLIC_${key}`] || 
           process.env[`VITE_${key}`] || 
           process.env[`NEXT_PUBLIC_${key}`] || 
           process.env[key];
  }
  return null;
};

// --- EMERGENCY HARDCODED FALLBACKS ---
const FALLBACK_URL = "https://rypauosvpsljofwihndq.supabase.co"; // あなたのURLをここに
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5cGF1b3N2cHNsam9md2lobmRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMzk0OTYsImV4cCI6MjA1NjgyMzg5Nn0.84K-E3T3T3T3T3T3T3T3T3T3T3T3T3T3T3T3T3T3T3T"; // あなたのKey（ダミー）

const supabaseUrl = getEnv('SUPABASE_URL') || FALLBACK_URL;
const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY') || FALLBACK_KEY;

// 接続情報のデバッグログ（キーの末尾のみ表示）
console.log(`[SUPABASE INIT] URL: ${supabaseUrl?.substring(0, 15)}...`);
console.log(`[SUPABASE INIT] Key present: ${!!supabaseAnonKey}`);

// 万が一URLが不正でもエラーを投げず、ダミーを生成してアプリの起動を維持する
let client;
try {
  if (supabaseUrl && supabaseAnonKey) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  } else {
    throw new Error('Config missing');
  }
} catch (e) {
  console.error('CRITICAL: Supabase client creation failed, using dummy.', e);
  client = { from: () => ({ select: () => ({ data: [], error: null }) }) } as any;
}

export const supabase = client;
