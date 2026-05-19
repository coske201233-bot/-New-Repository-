import { createClient } from '@supabase/supabase-js';

/**
 * [V46.0 - HARDCODED BYPASS]
 * 環境変数の解決がWindows環境で不安定なため、
 * Supabaseの接続情報を直接コードに埋め込みます。
 */
const supabaseUrl = "https://placeholder-project.supabase.co";
const supabaseAnonKey = "DISABLED_TO_PROTECT_PRODUCTION_DATA";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false, // 本番への永続化もオフ！
  },
});

/**
 * [V47.0] 開発用ロックダウンモード
 */
export const isSupabaseAuthReady = false;

console.log("⚠️ [V47.0 - SAFE LOCKDOWN] Supabase is DISABLED to protect production data.");
