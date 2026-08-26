import { supabase } from './supabase';

export interface CreateStaffParams {
  name: string;
  email: string;
  password: string;
  position?: string;
  profession?: string;
  jobType?: string;
  placement?: string;
  status?: string;
  role?: string;
  initial_leave_days?: number;
  no_holiday?: boolean;
  holidaySetting?: boolean;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
}

export interface UpdateStaffParams {
  staffId: string;
  userId?: string;
  name?: string;
  email?: string;
  position?: string;
  profession?: string;
  jobType?: string;
  placement?: string;
  status?: string;
  role?: string;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
  initial_leave_days?: number;
  no_holiday?: boolean;
  holidaySetting?: boolean;
}

/**
 * Supabase セッションから JWT アクセストークンを取得します
 */
export const getAuthToken = async (): Promise<string | null> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch (err) {
    console.error('[adminStaffApi] Failed to get auth token:', err);
    return null;
  }
};

/**
 * 実行環境に応じたベース URL を取得
 */
const getBaseUrl = (): string => {
  // 1. 環境変数が設定されていればそれを最優先
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
  }

  // 2. ブラウザ環境（Web）で localhost 以外の本番ホストなら origin を使用
  if (typeof window !== 'undefined' && window.location?.origin) {
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (!isLocalhost) {
      return window.location.origin;
    }
  }

  // 3. ローカル開発時またはネイティブ実機時のデフォルトフォールバック
  return 'https://mobile-app-project-sigma.vercel.app';
};

/**
 * サーバーサイド API へのリクエスト共通関数
 */
async function callAdminStaffApi(action: string, payload: any = {}, method: 'POST' | 'GET' = 'POST') {
  const token = await getAuthToken();
  if (!token) {
    console.error('[adminStaffApi] 認証トークン取得失敗: セッションが存在しません');
    throw new Error('ログインセッション（トークン）が取得できませんでした。再ログインしてください。');
  }

  const baseUrl = getBaseUrl();
  const endpoint = `${baseUrl}/api/admin/staff`;

  console.log('📡 [adminStaffApi] API送信開始:', {
    method,
    endpoint,
    action,
    payload,
    hasToken: !!token,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (method === 'POST') {
    options.body = JSON.stringify({ action, payload, ...payload });
  }

  try {
    const response = await fetch(endpoint, options);
    const data = await response.json().catch(() => null);

    console.log('📥 [adminStaffApi] APIレスポンス受信:', {
      status: response.status,
      ok: response.ok,
      data,
    });

    if (!response.ok) {
      const errorMsg = data?.error || `APIエラー (${response.status}): 処理に失敗しました。`;
      throw new Error(errorMsg);
    }

    return data;
  } catch (err: any) {
    console.error('❌ [adminStaffApi] 通信エラー発生:', err);
    throw err;
  }
}

/**
 * 1. 新規スタッフ登録 (Auth ユーザー & public.staff 同時作成)
 */
export async function createStaffApi(params: CreateStaffParams) {
  console.log('🚀 [adminStaffApi] createStaffApi 呼び出し:', params);
  return await callAdminStaffApi('CREATE', params);
}

/**
 * 2. スタッフ情報・メールアドレス変更 (Auth & staff 連動更新)
 */
export async function updateStaffInfoApi(params: UpdateStaffParams) {
  console.log('🚀 [adminStaffApi] updateStaffInfoApi 呼び出し:', params);
  return await callAdminStaffApi('UPDATE_INFO', params);
}

/**
 * 3. パスワード強制変更 (Auth.users のパスワード即時更新)
 */
export async function updateStaffPasswordApi(staffId: string, newPassword: string, userId?: string) {
  console.log('🚀 [adminStaffApi] updateStaffPasswordApi 呼び出し:', { staffId, userId });
  return await callAdminStaffApi('UPDATE_PASSWORD', {
    staffId,
    userId,
    newPassword,
  });
}

/**
 * 4. スタッフの無効化（論理削除）または完全削除（物理削除）
 */
export async function deleteStaffApi(staffId: string, permanent: boolean = false, userId?: string) {
  const effectiveUserId = userId || staffId;
  console.log('🚀 [adminStaffApi] deleteStaffApi 呼び出し:', { staffId, permanent, userId: effectiveUserId });
  return await callAdminStaffApi('DELETE', {
    staffId,
    userId: effectiveUserId,
    permanent,
  });
}

/**
 * 5. スタッフ一覧（Auth連携状態付き）の取得
 */
export async function fetchAdminStaffListApi() {
  console.log('🚀 [adminStaffApi] fetchAdminStaffListApi 呼び出し');
  return await callAdminStaffApi('LIST', {}, 'GET');
}
