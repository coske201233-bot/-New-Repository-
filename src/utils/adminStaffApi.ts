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
  rotation_order?: number | null;
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
  rotation_order?: number | null;
}

/**
 * スタッフが休日出勤ローテーション対象かどうかを判定
 */
export function isStaffRotationTarget(s: any): boolean {
  if (!s) return false;
  const status = String(s.status || '').trim();
  if (status === '無効') return false;

  const noHoliday =
    s.no_holiday === true ||
    s.no_holiday === 'true' ||
    s.noHoliday === true ||
    s.holidaySetting === true;
  if (noHoliday) return false;

  const placement = String(s.placement || '').trim();
  const profession = String(s.profession || s.jobType || s.job_type || '').trim();
  const role = String(s.role || s.position || '').trim();

  if (placement.includes('訪問リハ') || placement.includes('事務') || placement.includes('助手')) return false;
  if (profession.includes('助手') || profession.includes('事務')) return false;
  if (role.includes('助手')) return false;

  return true;
}

/**
 * ローテーション対象外となる理由ラベルを取得（対象内の場合は null）
 */
export function getStaffRotationExclusionReason(s: any): string | null {
  if (!s) return 'データなし';
  const status = String(s.status || '').trim();
  if (status === '無効') return '無効（退職・停止）';

  const placement = String(s.placement || '').trim();
  const profession = String(s.profession || s.jobType || s.job_type || '').trim();
  const role = String(s.role || s.position || '').trim();

  if (placement.includes('訪問リハ')) return '訪問リハ（専従・対象外）';
  if (profession.includes('助手') || placement.includes('助手') || role.includes('助手')) return '助手（対象外）';
  if (placement.includes('事務') || profession.includes('事務')) return '事務（対象外）';

  const noHoliday =
    s.no_holiday === true ||
    s.no_holiday === 'true' ||
    s.noHoliday === true ||
    s.holidaySetting === true;
  if (noHoliday) return '土日祝休み設定';

  return null;
}

/**
 * Supabase 上の staff テーブルの rotation_order を 1, 2, 3... と歯抜けなく再採番して同期する
 */
export async function reindexStaffRotationOrderInDb(preferredOrderIds?: string[]): Promise<any[]> {
  try {
    const { data: allStaff, error: fetchErr } = await supabase
      .from('staff')
      .select('*')
      .order('rotation_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (fetchErr || !allStaff) {
      console.warn('[adminStaffApi] reindexStaffRotationOrderInDb fetch warning:', fetchErr?.message);
      return [];
    }

    const eligible: any[] = [];
    const excluded: any[] = [];

    for (const s of allStaff) {
      if (isStaffRotationTarget(s)) {
        eligible.push(s);
      } else {
        excluded.push(s);
      }
    }

    const cleanOrderIds = Array.isArray(preferredOrderIds)
      ? preferredOrderIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    eligible.sort((a, b) => {
      if (cleanOrderIds.length > 0) {
        const idxA = cleanOrderIds.indexOf(String(a.id));
        const idxB = cleanOrderIds.indexOf(String(b.id));
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
      }
      const roA =
        a.rotation_order !== null && a.rotation_order !== undefined && a.rotation_order !== ''
          ? Number(a.rotation_order)
          : 999999;
      const roB =
        b.rotation_order !== null && b.rotation_order !== undefined && b.rotation_order !== ''
          ? Number(b.rotation_order)
          : 999999;
      if (roA !== roB) return roA - roB;
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tA - tB;
    });

    // 1. ローテーション対象スタッフを 1, 2, 3... に連番更新
    for (let i = 0; i < eligible.length; i++) {
      const desiredOrder = i + 1;
      const staff = eligible[i];
      if (Number(staff.rotation_order) !== desiredOrder) {
        const { error: upErr } = await supabase
          .from('staff')
          .update({ rotation_order: desiredOrder })
          .eq('id', staff.id);
        if (!upErr) {
          staff.rotation_order = desiredOrder;
        } else {
          console.warn(`[adminStaffApi] Failed to update rotation_order for ${staff.name}:`, upErr.message);
        }
      } else {
        staff.rotation_order = desiredOrder;
      }
    }

    // 2. ローテーション対象外スタッフの rotation_order を null にクリア
    for (const staff of excluded) {
      if (staff.rotation_order !== null && staff.rotation_order !== undefined) {
        const { error: upErr } = await supabase
          .from('staff')
          .update({ rotation_order: null })
          .eq('id', staff.id);
        if (!upErr) {
          staff.rotation_order = null;
        } else {
          console.warn(`[adminStaffApi] Failed to clear rotation_order for ${staff.name}:`, upErr.message);
        }
      } else {
        staff.rotation_order = null;
      }
    }

    return [...eligible, ...excluded];
  } catch (err) {
    console.warn('[adminStaffApi] reindexStaffRotationOrderInDb exception:', err);
    return [];
  }
}

/**
 * Supabase セッションから JWT アクセストークンを取得します (自動リフレッシュ & 多層フォールバック対応)
 */
export const getAuthToken = async (): Promise<string | null> => {
  try {
    // 1. 通常の getSession
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (session?.access_token) {
      return session.access_token;
    }

    // 2. セッション未取得または期限切れの場合は自動リフレッシュを試行
    console.warn('[adminStaffApi] Session null or expired, attempting refreshSession()...', sessionError?.message);
    const { data: refreshData } = await supabase.auth.refreshSession();
    if (refreshData?.session?.access_token) {
      console.log('✅ [adminStaffApi] Successfully refreshed auth session');
      return refreshData.session.access_token;
    }

    // 3. getUser() で現在のユーザー認証状態を確認
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      const { data: retrySession } = await supabase.auth.getSession();
      if (retrySession?.session?.access_token) {
        return retrySession.session.access_token;
      }
    }

    // 4. Web LocalStorage から直接トークンを抽出・復元 (Fallback)
    if (typeof window !== 'undefined' && window.localStorage) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
          try {
            const parsed = JSON.parse(localStorage.getItem(key) || '{}');
            const token = parsed?.access_token || parsed?.currentSession?.access_token;
            if (token) {
              console.log('✅ [adminStaffApi] Recovered auth token from localStorage key:', key);
              return token;
            }
          } catch {}
        }
      }
    }

    return null;
  } catch (err) {
    console.error('[adminStaffApi] Failed to get auth token:', err);
    return null;
  }
};

/**
 * クライアント直接 Supabase DB 更新フォールバック (RLS/権限がある場合)
 */
export async function directStaffDbUpdate(params: UpdateStaffParams) {
  const { staffId, userId, ...fields } = params;
  const targetId = staffId || userId;
  if (!targetId) throw new Error('staffId または userId が必要です。');

  const updateObj: any = {};
  if (fields.name !== undefined) updateObj.name = fields.name.trim();
  if (fields.email !== undefined) updateObj.email = fields.email.trim().toLowerCase();
  if (fields.position !== undefined) updateObj.position = fields.position;
  if (fields.profession || fields.jobType) updateObj.profession = fields.profession || fields.jobType;
  if (fields.placement !== undefined) updateObj.placement = fields.placement;
  if (fields.status !== undefined) updateObj.status = fields.status;
  if (fields.role !== undefined) updateObj.role = fields.role;
  if (fields.leave_start_date !== undefined) updateObj.leave_start_date = fields.leave_start_date;
  if (fields.leave_end_date !== undefined) updateObj.leave_end_date = fields.leave_end_date;
  if (fields.no_holiday !== undefined) updateObj.no_holiday = !!fields.no_holiday;
  else if (fields.holidaySetting !== undefined) updateObj.no_holiday = !!fields.holidaySetting;
  if (fields.initial_leave_days !== undefined) updateObj.initial_leave_days = fields.initial_leave_days;
  if (fields.rotation_order !== undefined) updateObj.rotation_order = fields.rotation_order;

  console.log('🔄 [adminStaffApi] Executing direct DB update fallback for staff:', targetId, updateObj);

  const { data, error } = await supabase
    .from('staff')
    .update(updateObj)
    .eq('id', targetId)
    .select();

  if (error) {
    // leave_start_date 等のカラム未作成エラーの場合はカラムを除外して再試行
    if (error.message?.includes('leave_start_date') || error.message?.includes('leave_end_date') || error.code === '42703') {
      const fallbackObj = { ...updateObj };
      delete fallbackObj.leave_start_date;
      delete fallbackObj.leave_end_date;
      const { data: fbData, error: fbError } = await supabase
        .from('staff')
        .update(fallbackObj)
        .eq('id', targetId)
        .select();
      if (fbError) throw fbError;
      return fbData;
    }
    throw error;
  }
  return data;
}

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
    console.warn('[adminStaffApi] 認証トークン取得不可: セッションが存在しません');
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
 * 1. 新規スタッフ登録 (Auth ユーザー & public.staff 同時作成 + ローテーション順末尾への自動追加)
 */
export async function createStaffApi(params: CreateStaffParams) {
  console.log('🚀 [adminStaffApi] createStaffApi 呼び出し:', params);
  const res = await callAdminStaffApi('CREATE', params);
  const reindexedList = await reindexStaffRotationOrderInDb();
  return {
    ...res,
    staffList: reindexedList.length > 0 ? reindexedList : res?.staffList,
  };
}

/**
 * 2. スタッフ情報・メールアドレス変更 (Auth & staff 連動更新 + ローテーション順自動再整備)
 */
export async function updateStaffInfoApi(params: UpdateStaffParams) {
  console.log('🚀 [adminStaffApi] updateStaffInfoApi 呼び出し:', params);
  try {
    const res = await callAdminStaffApi('UPDATE_INFO', params);
    const reindexedList = await reindexStaffRotationOrderInDb();
    return {
      ...res,
      staffList: reindexedList.length > 0 ? reindexedList : res?.staffList,
    };
  } catch (err: any) {
    console.warn('⚠️ [adminStaffApi] API call failed, attempting direct DB update fallback...', err.message);
    try {
      const res = await directStaffDbUpdate(params);
      const reindexedList = await reindexStaffRotationOrderInDb();
      console.log('✅ [adminStaffApi] Direct DB update fallback succeeded:', res);
      return { success: true, staff: res?.[0], staffList: reindexedList, isDirectUpdate: true };
    } catch (dbErr: any) {
      console.error('❌ [adminStaffApi] Direct DB update also failed:', dbErr);
      throw err;
    }
  }
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
 * 4. スタッフの無効化（論理削除）または完全削除（物理削除） + 残りスタッフのローテーション順再採番
 */
export async function deleteStaffApi(staffId: string, permanent: boolean = false, userId?: string) {
  const effectiveUserId = userId || staffId;
  console.log('🚀 [adminStaffApi] deleteStaffApi 呼び出し:', { staffId, permanent, userId: effectiveUserId });
  const res = await callAdminStaffApi('DELETE', {
    staffId,
    userId: effectiveUserId,
    permanent,
  });
  // 無効化の場合も確実に rotation_order を null にした上で残りのスタッフを 1, 2, 3... に再採番
  if (!permanent && staffId) {
    try {
      await supabase.from('staff').update({ rotation_order: null }).eq('id', staffId);
    } catch {}
  }
  const reindexedList = await reindexStaffRotationOrderInDb();
  return {
    ...res,
    staffList: reindexedList.length > 0 ? reindexedList : res?.staffList,
  };
}

/**
 * 5. ローテーション順番の一括変更・連番保存 (1, 2, 3...)
 */
export async function updateRotationOrderApi(orderedStaffIds: string[]) {
  console.log('🚀 [adminStaffApi] updateRotationOrderApi 呼び出し:', orderedStaffIds);
  // 1. まず Admin API 経由で更新を試行（未デプロイ環境等の場合はフォールバックへ）
  try {
    await callAdminStaffApi('UPDATE_ROTATION_ORDER', { orderedStaffIds });
  } catch (apiErr: any) {
    console.warn('[adminStaffApi] UPDATE_ROTATION_ORDER API fallback to direct DB reindex:', apiErr?.message);
  }
  // 2. 直接 Supabase の staff.rotation_order カラムを 1, 2, 3... に確実に同期更新
  const reindexedList = await reindexStaffRotationOrderInDb(orderedStaffIds);
  return {
    success: true,
    staffList: reindexedList,
  };
}

/**
 * 6. スタッフ一覧（Auth連携状態付き）の取得
 */
export async function fetchAdminStaffListApi() {
  console.log('🚀 [adminStaffApi] fetchAdminStaffListApi 呼び出し');
  return await callAdminStaffApi('LIST', {}, 'GET');
}
