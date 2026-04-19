import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * シニアアーキテクト指令: "e is not a function" 根絶スタブ
 * Supabaseが未設定の場合でも、JSランタイムエラーを起こさず、
 * 非同期関数として振る舞うプロキシオブジェクトを提供します。
 */
const createSafeStub = () => {
  const stub: any = new Proxy(() => {}, {
    get: (target, prop) => {
      // React / Webpack 内部シンポルのガード
      if (typeof prop === 'symbol' || prop === '$$typeof') return undefined;
      
      // クリティカル: authメソッドは必ず非同期関数を返す
      if (prop === 'auth') {
        return {
          signInWithPassword: async () => ({ data: { user: { id: 'local-admin', email: 'admin@example.com' } }, error: null }),
          signUp: async () => ({ data: { user: { id: 'local-user' } }, error: null }),
          signOut: async () => ({ error: null }),
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        };
      }

      // クエリチェーンのサポート
      if (['from', 'select', 'insert', 'update', 'upsert', 'delete', 'match', 'eq', 'single', 'order', 'range', 'limit'].includes(prop as string)) {
        return () => stub;
      }

      // 非同期対応 (thenable)
      if (prop === 'then') {
        return (onFulfilled: any) => Promise.resolve({ data: [], error: null }).then(onFulfilled);
      }

      return stub;
    },
    apply: () => stub,
  });
  return stub;
};

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : createSafeStub();

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);
