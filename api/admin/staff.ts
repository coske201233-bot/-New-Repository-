import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

/**
 * スタッフが休日出勤ローテーション対象かどうかを判定
 * - 無効（退職・停止）、土日祝休み設定 (no_holiday)、訪問リハ、助手、事務 はローテーション対象外 (null)
 * - 長期休暇・入職前・常勤・時短勤務 はローテーション順リストの対象（自動生成時は期間に応じてスキップ）
 */
function isStaffRotationTarget(s: any): boolean {
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
 * ローテーション対象スタッフの rotation_order を 1, 2, 3... と歯抜けなく連番再採番し、
 * 対象外・無効スタッフの rotation_order を null に設定して DB を更新するヘルパー
 */
async function reindexStaffRotationOrder(supabaseAdmin: any, preferredOrderIds?: string[]) {
  const { data: allStaff, error: fetchErr } = await supabaseAdmin
    .from('staff')
    .select('*')
    .order('rotation_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (fetchErr || !allStaff) {
    console.warn('[reindexStaffRotationOrder] スタッフ一覧の取得に失敗:', fetchErr?.message);
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

  // 1. ローテーション対象スタッフを 1, 2, 3... に更新
  for (let i = 0; i < eligible.length; i++) {
    const desiredOrder = i + 1;
    const staff = eligible[i];
    if (Number(staff.rotation_order) !== desiredOrder) {
      const { error: upErr } = await supabaseAdmin
        .from('staff')
        .update({ rotation_order: desiredOrder })
        .eq('id', staff.id);
      if (!upErr) {
        staff.rotation_order = desiredOrder;
      } else {
        console.warn(`[reindexStaffRotationOrder] ${staff.name} の rotation_order 更新警告:`, upErr.message);
      }
    } else {
      staff.rotation_order = desiredOrder;
    }
  }

  // 2. ローテーション対象外・無効スタッフの rotation_order を null にクリア
  for (const staff of excluded) {
    if (staff.rotation_order !== null && staff.rotation_order !== undefined) {
      const { error: upErr } = await supabaseAdmin
        .from('staff')
        .update({ rotation_order: null })
        .eq('id', staff.id);
      if (!upErr) {
        staff.rotation_order = null;
      } else {
        console.warn(`[reindexStaffRotationOrder] 対象外 ${staff.name} の rotation_order クリア警告:`, upErr.message);
      }
    } else {
      staff.rotation_order = null;
    }
  }

  return [...eligible, ...excluded];
}

/**
 * 管理者専用スタッフ管理 API
 * POST /api/admin/staff
 * GET /api/admin/staff
 */
export default async function handler(req: any, res: any) {
  const origin = req.headers.origin || '*';

  // CORS ヘッダー設定
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // プリフライトリクエスト（OPTIONS）は最優先で即終了
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const supabaseUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://nizhtuzqmtlgfqmxpybb.supabase.co';

  const supabaseAnonKey =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

  const supabaseServiceKey =
    process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
    '';

  const parsedBody =
    typeof req.body === 'string'
      ? (() => {
          try {
            return JSON.parse(req.body);
          } catch {
            return {};
          }
        })()
      : req.body || {};
  const requestedAction = String(parsedBody.action || '').toUpperCase();

  if (
    !supabaseUrl ||
    (!supabaseServiceKey &&
      requestedAction !== 'UPSERT_CONFIG' &&
      requestedAction !== 'UPDATE_ROTATION_ORDER')
  ) {
    console.error('❌ Supabase credentials missing: Service Role Key が設定されていません。');
    return res.status(500).json({
      error: 'サーバー設定エラー: SUPABASE_SERVICE_ROLE_KEY が設定されていません。',
    });
  }

  // 1. 一般用クライアント（認証セッション検証用）
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // 3. 認証・認可チェック
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: '認証ヘッダー (Authorization) がありません。' });
  }

  // 2. 特権用クライアント（Admin操作用 / Service Role 未設定時は認証ヘッダー付きクライアントへフォールバック）
  const supabaseAdmin = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      });

  const token = authHeader.replace('Bearer ', '').trim();
  const {
    data: { user: callerUser },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !callerUser) {
    return res.status(401).json({ error: '無効な認証セッションです。再ログインしてください。' });
  }

  // 管理者権限の判定
  const callerEmail = (callerUser.email || '').toLowerCase();
  const isMasterEmail =
    callerEmail === 'admin@reha.local' ||
    callerEmail.includes('admin') ||
    callerEmail.includes('makoto');

  let isCallerAdmin = isMasterEmail;

  if (!isCallerAdmin) {
    // staff テーブルでの権限確認 (is_admin カラム不在によるエラーを避けるため * を取得)
    const { data: staffRecord } = await supabaseAdmin
      .from('staff')
      .select('*')
      .or(`user_id.eq.${callerUser.id},id.eq.${callerUser.id},email.eq.${callerUser.email}`)
      .maybeSingle();

    if (
      staffRecord?.is_admin === true ||
      staffRecord?.role?.includes('管理者') ||
      staffRecord?.role?.includes('開発者') ||
      staffRecord?.role === 'admin' ||
      staffRecord?.position?.includes('科長') ||
      staffRecord?.position?.includes('係長')
    ) {
      isCallerAdmin = true;
    }
  }

  if (!isCallerAdmin) {
    return res.status(403).json({ error: '管理者権限が必要です。(403 Forbidden)' });
  }

  // 4. GET メソッド：スタッフ一覧および Auth ユーザー情報の同期確認
  if (req.method === 'GET') {
    try {
      const { data: staffList, error: staffError } = await supabaseAdmin
        .from('staff')
        .select('*')
        .order('rotation_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });

      if (staffError) throw staffError;

      // Auth ユーザー一覧も取得
      const { data: authData } =
        await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });

      const authUserMap = new Map();
      if (authData?.users) {
        authData.users.forEach((u: any) => {
          authUserMap.set(u.id, u);
          if (u.email) authUserMap.set(u.email.toLowerCase(), u);
        });
      }

      const mergedList = (staffList || []).map((s) => {
        const matchingAuth =
          (s.user_id && authUserMap.get(s.user_id)) ||
          (s.id && authUserMap.get(s.id)) ||
          (s.email && authUserMap.get(s.email.toLowerCase()));

        const lStart = s.leave_start_date || matchingAuth?.user_metadata?.leave_start_date || null;
        const lEnd = s.leave_end_date || matchingAuth?.user_metadata?.leave_end_date || null;

        return {
          ...s,
          leave_start_date: lStart,
          leaveStartDate: lStart,
          leave_end_date: lEnd,
          leaveEndDate: lEnd,
          auth_user_id: matchingAuth?.id || s.user_id || null,
          has_auth_account: !!matchingAuth,
          banned: !!matchingAuth?.banned_until,
          email_confirmed_at: matchingAuth?.email_confirmed_at,
        };
      });

      return res.status(200).json({ success: true, staff: mergedList });
    } catch (err: any) {
      console.error('GET Staff List Error:', err);
      return res.status(500).json({ error: err.message || 'スタッフ一覧の取得に失敗しました。' });
    }
  }

  // 5. POST メソッド：アクションに応じた処理
  if (req.method === 'POST') {
    const { action, payload } = parsedBody;
    const effectivePayload = payload || parsedBody;
    const currentAction = String(action || parsedBody.action || '').toUpperCase();

    try {
      switch (currentAction) {
        // ==========================================
        // 1. 新規スタッフ登録 (action: 'CREATE')
        // ==========================================
        case 'CREATE': {
          const {
            name,
            email,
            password,
            position,
            profession,
            jobType,
            placement,
            status,
            role,
            no_holiday,
            holidaySetting,
            initial_leave_days,
          } = effectivePayload;

          if (!name || !email || !password) {
            return res.status(400).json({
              error: 'メールアドレス、パスワード、氏名は必須です。',
            });
          }

          const cleanEmail = email.trim().toLowerCase();
          const cleanName = name.trim();
          const appRole =
            role && (role.includes('管理者') || role === 'admin')
              ? '管理者,スタッフ'
              : 'スタッフ';

          // 1-1. Auth ユーザーの作成 (即時有効化)
          const { data: newAuthData, error: createAuthError } =
            await supabaseAdmin.auth.admin.createUser({
              email: cleanEmail,
              password: password.trim(),
              email_confirm: true,
              user_metadata: {
                name: cleanName,
                full_name: cleanName,
                role: appRole,
                position: position || 'スタッフ',
                profession: jobType || profession || 'スタッフ',
              },
            });

          if (createAuthError) {
            console.error('Auth Create Error:', createAuthError);
            return res.status(400).json({
              error: `認証アカウント作成失敗: ${createAuthError.message}`,
            });
          }

          const newAuthUserId = newAuthData.user.id;

          // 1-2. staff テーブルへの挿入オブジェクト (user_id と id の両方に newAuthUserId を設定)
          const isNoHoliday =
            no_holiday !== undefined
              ? !!no_holiday
              : holidaySetting !== undefined
              ? !!holidaySetting
              : false;

          const baseStaffPayload: any = {
            id: newAuthUserId,
            user_id: newAuthUserId,
            name: cleanName,
            email: cleanEmail,
            role: appRole,
            position: position || '一般',
            placement: placement || '一般',
            status: status || '常勤',
            no_holiday: isNoHoliday,
            is_approved: true,
            created_at: new Date().toISOString(),
          };

          if (jobType || profession) {
            baseStaffPayload.profession = jobType || profession;
          }
          if (initial_leave_days !== undefined && !isNaN(Number(initial_leave_days))) {
            baseStaffPayload.initial_leave_days = Number(initial_leave_days);
          }

          // 1-3. 新規スタッフのローテーション順番 (rotation_order) を自動採番
          // ローテーション対象スタッフの場合は現在の最大値 + 1（末尾）、対象外職種・設定の場合は null
          const isTarget = isStaffRotationTarget(baseStaffPayload);
          if (isTarget) {
            const { data: currentStaffRows } = await supabaseAdmin
              .from('staff')
              .select('id, status, no_holiday, placement, profession, role, rotation_order');
            let maxOrder = 0;
            (currentStaffRows || []).forEach((row: any) => {
              if (isStaffRotationTarget(row)) {
                const ro = Number(row.rotation_order);
                if (!isNaN(ro) && ro > maxOrder) {
                  maxOrder = ro;
                }
              }
            });
            baseStaffPayload.rotation_order = maxOrder + 1;
          } else {
            baseStaffPayload.rotation_order = null;
          }

          // 挿入試行 (カラム差異への柔軟な対応)
          let newStaff: any = null;
          let insertStaffError: any = null;

          const { data: inserted, error: insertErr } = await supabaseAdmin
            .from('staff')
            .insert([baseStaffPayload])
            .select()
            .single();

          if (insertErr) {
            // もし profession / initial_leave_days カラム起因等の場合は調整して再試行
            console.warn('Initial insert attempt error:', insertErr.message);
            const fallbackPayload = { ...baseStaffPayload };
            delete fallbackPayload.initial_leave_days;
            if (jobType || profession) {
              fallbackPayload.job_type = jobType || profession;
            }
            const { data: fallbackInserted, error: fallbackErr } = await supabaseAdmin
              .from('staff')
              .insert([fallbackPayload])
              .select()
              .single();

            if (fallbackErr) {
              insertStaffError = fallbackErr;
            } else {
              newStaff = fallbackInserted;
            }
          } else {
            newStaff = inserted;
          }

          if (insertStaffError) {
            console.error('Staff Insert Error:', insertStaffError);
            // staff 登録失敗時は Auth アカウントをロールバック削除
            await supabaseAdmin.auth.admin.deleteUser(newAuthUserId).catch((e: any) => {
              console.warn('Rollback delete user warning:', e.message);
            });
            return res.status(500).json({
              error: `スタッフ名簿登録失敗のためロールバックしました: ${insertStaffError.message}`,
            });
          }

          // 全体の連番（1, 2, 3...）を再整備して歯抜けを防止
          const reindexedList = await reindexStaffRotationOrder(supabaseAdmin);
          const refreshedNewStaff =
            reindexedList.find((s: any) => s.id === newStaff?.id) || newStaff;

          return res.status(201).json({
            success: true,
            message: 'スタッフおよび認証アカウントを正常に作成しました。',
            staff: refreshedNewStaff,
            staffList: reindexedList,
            user: newAuthData.user,
          });
        }

        // ==========================================
        // 2. スタッフ情報・メールアドレス変更 (action: 'UPDATE_INFO')
        // ==========================================
        case 'UPDATE_INFO': {
          const {
            staffId,
            userId,
            name,
            email,
            position,
            profession,
            jobType,
            placement,
            status,
            role,
            no_holiday,
            holidaySetting,
            leave_start_date,
            leave_end_date,
            leaveStartDate,
            leaveEndDate,
            rotation_order,
          } = effectivePayload;

          const targetStaffId = staffId || userId;
          if (!targetStaffId) {
            return res.status(400).json({ error: 'staffId または userId が必要です。' });
          }

          const isLongTerm = status === '長期休暇';
          const finalLeaveStartDate = isLongTerm ? (leave_start_date !== undefined ? leave_start_date : leaveStartDate) : null;
          const finalLeaveEndDate = isLongTerm ? (leave_end_date !== undefined ? leave_end_date : leaveEndDate) : null;

          // 既存の staff レコードを取得して user_id / email を確認
          const { data: existingStaff } = await supabaseAdmin
            .from('staff')
            .select('*')
            .eq('id', targetStaffId)
            .maybeSingle();

          const targetUserId =
            userId ||
            existingStaff?.user_id ||
            (existingStaff?.id?.length === 36 ? existingStaff.id : null);
          const cleanEmail = email ? email.trim().toLowerCase() : undefined;
          const cleanName = name ? name.trim() : undefined;
          const appRole = role
            ? role.includes('管理者') || role === 'admin'
              ? '管理者,スタッフ'
              : 'スタッフ'
            : undefined;

          // 2-1. Auth ユーザーの更新（存在する場合）
          if (targetUserId && targetUserId.length === 36) {
            const authUpdatePayload: any = {};
            if (cleanEmail) {
              authUpdatePayload.email = cleanEmail;
              authUpdatePayload.email_confirm = true;
            }

            const currentMetadata = {};
            authUpdatePayload.user_metadata = {
              ...currentMetadata,
              ...(cleanName && { name: cleanName, full_name: cleanName }),
              ...(appRole && { role: appRole }),
              ...(position && { position }),
              ...((jobType || profession) && { profession: jobType || profession }),
              ...(finalLeaveStartDate !== undefined && { leave_start_date: finalLeaveStartDate }),
              ...(finalLeaveEndDate !== undefined && { leave_end_date: finalLeaveEndDate }),
            };

            const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
              targetUserId,
              authUpdatePayload
            );

            if (authUpdateError) {
              console.warn('Auth User Update Warn:', authUpdateError.message);
            }
          }

          // 2-2. public.staff テーブルの更新 (未定義カラムは除外)
          const staffUpdatePayload: any = {};
          if (cleanName !== undefined) staffUpdatePayload.name = cleanName;
          if (cleanEmail !== undefined) staffUpdatePayload.email = cleanEmail;
          if (position !== undefined) staffUpdatePayload.position = position;
          if (jobType || profession) {
            staffUpdatePayload.profession = jobType || profession;
          }
          if (placement !== undefined) staffUpdatePayload.placement = placement;
          if (status !== undefined) staffUpdatePayload.status = status;
          if (appRole !== undefined) staffUpdatePayload.role = appRole;
          if (finalLeaveStartDate !== undefined) staffUpdatePayload.leave_start_date = finalLeaveStartDate;
          if (finalLeaveEndDate !== undefined) staffUpdatePayload.leave_end_date = finalLeaveEndDate;
          if (no_holiday !== undefined) {
            staffUpdatePayload.no_holiday = !!no_holiday;
          } else if (holidaySetting !== undefined) {
            staffUpdatePayload.no_holiday = !!holidaySetting;
          }
          if (rotation_order !== undefined) {
            staffUpdatePayload.rotation_order = rotation_order;
          }

          let { data: updatedStaff, error: staffUpdateErr } = await supabaseAdmin
            .from('staff')
            .update(staffUpdatePayload)
            .eq('id', targetStaffId)
            .select()
            .single();

          if (staffUpdateErr && (staffUpdateErr.message?.includes('leave_start_date') || staffUpdateErr.message?.includes('leave_end_date') || staffUpdateErr.code === '42703')) {
            console.warn('Staff update without leave date columns fallback:', staffUpdateErr.message);
            const fallbackPayload = { ...staffUpdatePayload };
            delete fallbackPayload.leave_start_date;
            delete fallbackPayload.leave_end_date;
            const resFallback = await supabaseAdmin
              .from('staff')
              .update(fallbackPayload)
              .eq('id', targetStaffId)
              .select()
              .single();
            updatedStaff = resFallback.data;
            staffUpdateErr = resFallback.error;
          }

          if (staffUpdateErr) {
            console.error('Staff Update Error:', staffUpdateErr);
            return res.status(500).json({ error: staffUpdateErr.message });
          }

          // 職種・所属・土日祝休み・ステータスの変更に伴いローテーション対象状態が変わった場合も含め、連番を再整備
          const reindexedList = await reindexStaffRotationOrder(supabaseAdmin);
          const refreshedStaff =
            reindexedList.find((s: any) => s.id === targetStaffId) || updatedStaff;

          return res.status(200).json({
            success: true,
            message: 'スタッフ情報を更新しました。',
            staff: refreshedStaff,
            staffList: reindexedList,
          });
        }

        // ==========================================
        // 3. パスワード強制変更 (action: 'UPDATE_PASSWORD')
        // ==========================================
        case 'UPDATE_PASSWORD': {
          const { staffId, userId, newPassword } = effectivePayload;

          if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
              error: '新しいパスワードは6文字以上で指定してください。',
            });
          }

          let targetAuthUserId = userId;

          if (!targetAuthUserId && staffId) {
            const { data: st } = await supabaseAdmin
              .from('staff')
              .select('user_id, id, email')
              .eq('id', staffId)
              .maybeSingle();

            targetAuthUserId = st?.user_id || (st?.id?.length === 36 ? st.id : null);

            if (!targetAuthUserId && st?.email) {
              const { data: authUser } = await supabaseAdmin.auth.admin.listUsers();
              const found = authUser?.users?.find(
                (u: any) => u.email?.toLowerCase() === st.email.toLowerCase()
              );
              if (found) targetAuthUserId = found.id;
            }
          }

          if (!targetAuthUserId) {
            return res.status(404).json({
              error: '対象スタッフの認証アカウント（Auth User）が見つかりません。',
            });
          }

          const { error: passError } = await supabaseAdmin.auth.admin.updateUserById(
            targetAuthUserId,
            { password: newPassword }
          );

          if (passError) {
            console.error('Password Update Error:', passError);
            return res.status(500).json({ error: `パスワード変更失敗: ${passError.message}` });
          }

          return res.status(200).json({
            success: true,
            message: 'パスワードを正常に変更しました。',
          });
        }

        // ==========================================
        // 4. スタッフ削除 / 無効化 (action: 'DELETE')
        // ==========================================
        case 'DELETE': {
          const { staffId, userId, permanent = false } = effectivePayload;
          const targetId = staffId || userId;

          if (!targetId) {
            return res.status(400).json({ error: 'staffId または userId が必要です。' });
          }

          // 1. 自身のアカウント保護
          if (targetId === callerUser.id || userId === callerUser.id) {
            return res.status(400).json({
              error: '現在ログイン中の管理者アカウント自身を削除・無効化することはできません。',
            });
          }

          // 2. staff レコードを事前に取得
          const { data: st } = await supabaseAdmin
            .from('staff')
            .select('*')
            .or(`id.eq.${targetId},user_id.eq.${targetId}`)
            .maybeSingle();

          // 3. 削除対象の Auth ユーザーID (UUID) を厳密に特定
          let authUserId: string | null = null;

          if (st?.user_id) {
            authUserId = st.user_id;
          } else if (targetId.length === 36) {
            authUserId = targetId;
          } else if (st?.email) {
            const { data: authUserList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
            const found = authUserList?.users?.find(
              (u: any) => u.email?.toLowerCase() === st.email.toLowerCase()
            );
            if (found) authUserId = found.id;
          }

          console.log('🗑️ 削除対象特定:', { targetId, authUserId, permanent });

          if (permanent === true) {
            // ─── 完全削除（物理削除） ───

            // 1. 先に staff テーブルのレコードを削除（外部キー依存の解除）
            const { error: delStaffErr } = await supabaseAdmin
              .from('staff')
              .delete()
              .or(`id.eq.${targetId},user_id.eq.${targetId}`);

            if (delStaffErr) {
              console.error('Staff DB Delete Error:', delStaffErr);
              return res.status(500).json({
                error: `スタッフ名簿の削除に失敗しました: ${delStaffErr.message}`,
              });
            }

            // 2. 次に Authentication ユーザーを削除
            if (authUserId) {
              const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
              if (authDelErr) {
                console.error('Auth User Delete Error:', authDelErr);
                return res.status(500).json({
                  error: `スタッフデータは削除されましたが、認証アカウント削除に失敗しました: ${authDelErr.message}`,
                });
              }
            }

            // 3. 残ったスタッフの rotation_order を 1, 2, 3... に連番再採番
            const reindexedList = await reindexStaffRotationOrder(supabaseAdmin);

            return res.status(200).json({
              success: true,
              message: 'スタッフおよび認証アカウントを完全に削除し、ローテーション順を再採番しました。',
              staffList: reindexedList,
            });

          } else {
            // ─── 無効化（論理削除） ───
            if (authUserId) {
              const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
                ban_duration: '876000h',
                user_metadata: {
                  ...(st?.name && { name: st.name }),
                  is_active: false,
                  disabled: true,
                },
              });
              if (banErr) {
                console.warn('Auth Ban Warning:', banErr.message);
              }
            }

            const { data: updatedStaff, error: deactErr } = await supabaseAdmin
              .from('staff')
              .update({
                status: '無効',
                is_approved: false,
                rotation_order: null,
              })
              .or(`id.eq.${targetId},user_id.eq.${targetId}`)
              .select()
              .single();

            if (deactErr) {
              console.error('Staff Deactivate Error:', deactErr);
              return res.status(500).json({ error: deactErr.message });
            }

            // 残ったスタッフの rotation_order を 1, 2, 3... に連番再採番
            const reindexedList = await reindexStaffRotationOrder(supabaseAdmin);

            return res.status(200).json({
              success: true,
              message: 'スタッフを無効化（ログイン停止）し、ローテーション順を再採番しました。',
              staff: updatedStaff,
              staffList: reindexedList,
            });
          }
        }

        // ==========================================
        // 5. ローテーション順の一括更新・再採番 (action: 'UPDATE_ROTATION_ORDER')
        // ==========================================
        case 'UPDATE_ROTATION_ORDER': {
          const { orderedStaffIds } = effectivePayload || {};
          if (!Array.isArray(orderedStaffIds)) {
            return res.status(400).json({
              error: 'orderedStaffIds（スタッフIDの配列）が必要です。',
            });
          }

          const reindexedList = await reindexStaffRotationOrder(supabaseAdmin, orderedStaffIds);

          return res.status(200).json({
            success: true,
            message: 'ローテーション順を更新しました。',
            staffList: reindexedList,
          });
        }

        // ==========================================
        // 6. アプリ設定の保存 (action: 'UPSERT_CONFIG')
        // ==========================================
        case 'UPSERT_CONFIG': {
          const { key, value } = effectivePayload || {};
          if (!key) {
            return res.status(400).json({ error: '設定キー (key) が必要です。' });
          }
          // app_config テーブルの実スキーマ (key: text PK, value: jsonb) に合わせて保存
          const { data: configData, error: configErr } = await supabaseAdmin
            .from('app_config')
            .upsert({ key: String(key), value }, { onConflict: 'key' })
            .select()
            .maybeSingle();

          if (configErr) {
            console.warn('Upsert Config API Warning:', configErr);
            if (!supabaseServiceKey) {
              // Service Role 未設定環境での RLS エラー時は 500 を返さず 200 (fallback) で応答
              return res.status(200).json({
                success: true,
                fallback: true,
                warning: configErr.message,
              });
            }
            return res.status(500).json({ error: configErr.message });
          }
          return res.status(200).json({ success: true, config: configData });
        }

        default:
          return res.status(400).json({
            error: `不明なアクションです: ${currentAction}。有効なアクション: CREATE, UPDATE_INFO, UPDATE_PASSWORD, DELETE, UPDATE_ROTATION_ORDER, UPSERT_CONFIG`,
          });
      }
    } catch (err: any) {
      console.error('Admin Staff API Error:', err);
      return res.status(500).json({ error: err.message || '内部サーバーエラーが発生しました。' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
