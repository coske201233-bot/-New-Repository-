import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * ユーザーまたはスタッフデータから管理者権限を包括的かつ安全に判定する共通ヘルパー
 * 
 * - user / profile / staff のいずれか、または両方を渡して判定可能
 * - 大文字・小文字の揺れ ('Admin', 'admin', 'ADMIN') を吸収
 * - role / position / permissions / is_admin / isAdmin のプロパティ違いを吸収
 * - email パターン (admin, makoto, yoshida 等) を吸収
 * - user_metadata / app_metadata を考慮
 */
export const checkIsAdmin = (user?: any, profileOrStaff?: any): boolean => {
  try {
    // 1. メールアドレスのチェック
    const rawEmails = [
      typeof user?.email === 'string' ? user.email : '',
      typeof profileOrStaff?.email === 'string' ? profileOrStaff.email : '',
    ];

    for (const rawEmail of rawEmails) {
      if (!rawEmail) continue;
      const email = rawEmail.trim().toLowerCase();
      if (
        email === 'admin@reha.local' ||
        email === 'admin@example.com' ||
        email === 'yoshida@reha.local' ||
        email.includes('admin') ||
        email.includes('makoto')
      ) {
        return true;
      }
    }

    // 2. 認証ユーザーオブジェクト (Supabase User) の判定
    if (user) {
      // Direct boolean flags
      if (user.is_admin === true || user.isAdmin === true) return true;

      // metadata checks
      const meta = user.user_metadata || {};
      const appMeta = user.app_metadata || {};
      if (meta.is_admin === true || meta.isAdmin === true || appMeta.is_admin === true) return true;

      const userRoles = [
        typeof user.role === 'string' ? user.role : '',
        typeof meta.role === 'string' ? meta.role : '',
        typeof appMeta.role === 'string' ? appMeta.role : '',
      ];

      for (const r of userRoles) {
        if (!r) continue;
        const normalized = r.trim().toLowerCase();
        if (
          normalized === 'admin' ||
          normalized === 'administrator' ||
          normalized.includes('admin') ||
          r.includes('管理者') ||
          r.includes('シフト管理者') ||
          r.includes('開発者')
        ) {
          return true;
        }
      }
    }

    // 3. プロファイル・スタッフオブジェクト (DB / State) の判定
    if (profileOrStaff) {
      // Direct boolean flags
      if (profileOrStaff.is_admin === true || profileOrStaff.isAdmin === true) return true;

      // role / position 文字列判定
      const rolesToCheck = [
        typeof profileOrStaff.role === 'string' ? profileOrStaff.role : '',
        typeof profileOrStaff.position === 'string' ? profileOrStaff.position : '',
      ];

      for (const r of rolesToCheck) {
        if (!r) continue;
        const normalized = r.trim().toLowerCase();
        if (
          normalized === 'admin' ||
          normalized === 'administrator' ||
          normalized.includes('admin') ||
          r.includes('管理者') ||
          r.includes('シフト管理者') ||
          r.includes('開発者')
        ) {
          return true;
        }
      }

      // permissions フィールド (配列または文字列)
      const perms = profileOrStaff.permissions;
      if (Array.isArray(perms)) {
        if (perms.some((p: any) => {
          const s = String(p || '').trim().toLowerCase();
          return s === 'admin' || s.includes('管理者') || s.includes('開発者');
        })) {
          return true;
        }
      } else if (typeof perms === 'string') {
        const lowerPerms = perms.toLowerCase();
        if (lowerPerms.includes('admin') || lowerPerms.includes('管理者') || lowerPerms.includes('開発者')) {
          return true;
        }
      }
    }

    return false;
  } catch (err) {
    console.error('[checkIsAdmin] Error checking admin status:', err);
    return false;
  }
};

/**
 * ロール文字列を取得するヘルパー ('admin' | 'staff')
 */
export const getUserRole = (user?: any, profileOrStaff?: any): 'admin' | 'staff' => {
  return checkIsAdmin(user, profileOrStaff) ? 'admin' : 'staff';
};

/**
 * ログアウトや管理者初期化時に、一般スタッフの選択状態や残存キャッシュを消去する
 */
export const cleanupStaffSelectionStorage = async () => {
  try {
    const keysToRemove = [
      '@selected_staff_id',
      '@active_staff',
      'selectedStaffId',
      'activeStaff',
      'proto_selected_staff'
    ];
    await AsyncStorage.multiRemove(keysToRemove).catch(() => {});

    if (typeof window !== 'undefined' && window.localStorage) {
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    }
  } catch (e) {
    console.warn('[cleanupStaffSelectionStorage] Warning during cleanup:', e);
  }
};
