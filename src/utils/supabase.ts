import { createClient } from '@supabase/supabase-js';

/**
 * [V46.0 - HARDCODED BYPASS]
 * 環境変数の解決がWindows環境で不安定なため、
 * Supabaseの接続情報を直接コードに埋め込みます。
 */
const supabaseUrl = "https://nizhtuzqmtlgfqmxpybb.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * [V46.0] 常にReadyとする
 */
export const isSupabaseAuthReady = true;

console.log("[V46.0 - HARDCODED BYPASS] Supabase Initialized with static credentials.");
