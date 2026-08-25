import { Platform } from 'react-native';

/**
 * PWA/ホーム画面追加アプリ向け 強制更新（キャッシュクリア＆再読込）
 * 
 * - ServiceWorkerの登録解除 (unregister)
 * - CacheStorageの全削除
 * - 認証セッションを保持しつつ、不要なブラウザキャッシュをパージ
 * - キャッシュバスター（タイムスタンプクエリ）を付与した強制再読み込み
 */
export const forceAppUpdate = async (): Promise<void> => {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // 1. ServiceWorker の登録解除
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        } catch (swErr) {
          console.warn('[appReloader] ServiceWorker unregister error:', swErr);
        }
      }

      // 2. ブラウザキャッシュ (CacheStorage) の全クリア
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          for (const key of keys) {
            await caches.delete(key);
          }
        } catch (cacheErr) {
          console.warn('[appReloader] Cache deletion error:', cacheErr);
        }
      }

      // 3. ローカルのキャッシュ・一時データのリフレッシュ（認証セッション自体は保持）
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('supabase.auth.token_cache');
        }
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.clear();
        }
      } catch (storageErr) {
        console.warn('[appReloader] Storage cleanup error:', storageErr);
      }

      // 4. 強制リロード（キャッシュバスター付与）
      const url = new URL(window.location.href);
      url.searchParams.set('_reload', Date.now().toString());
      window.location.href = url.toString();
      return;
    }

    // Web以外の環境（フォールバック）
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  } catch (error) {
    console.error('Force update error:', error);
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }
};
