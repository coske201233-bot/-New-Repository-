import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

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
    '';

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Supabase credentials missing: Service Role Key が設定されていません。');
    return res.status(500).json({
      error: 'サーバー設定エラー: SUPABASE_SERVICE_ROLE_KEY が設定されていません。',
    });
  }

  // 1. 一般用クライアント（認証セッション検証用）
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // 2. 特権用クライアント（Admin操作用）
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // 3. 認証・認可チェック
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: '認証ヘッダー (Authorization) がありません。' });
  }

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
    // staff テーブルでの権限確認
    const { data: staffRecord } = await supabaseAdmin
      .from('staff')
      .select('role, is_admin, position')
      .or(`user_id.eq.${callerUser.id},id.eq.${callerUser.id},email.eq.${callerUser.email}`)
      .maybeSingle();

    if (
      staffRecord?.is_admin === true ||
      staffRecord?.role?.includes('管理者') ||
      staffRecord?.role?.includes('開発者') ||
      staffRecord?.role === 'admin'
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
        .order('created_at', { ascending: false });

      if (staffError) throw staffError;

      // Auth ユーザー一覧も取得
      const { data: authData, error: authListError } =
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

        return {
          ...s,
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
    const { action, payload } = req.body || {};
    const effectivePayload = payload || req.body;
    const currentAction = (action || req.body.action || '').toUpperCase();

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

          // 挿入試行 (カラム差異への柔軟な対応)
          let newStaff: any = null;
          let insertStaffError: any = null;

          const { data: inserted, error: insertErr } = await supabaseAdmin
            .from('staff')
            .insert([baseStaffPayload])
            .select()
            .single();

          if (insertErr) {
            // もし profession カラム起因等の場合は job_type を付与または調整して再試行
            console.warn('Initial insert attempt error:', insertErr.message);
            const fallbackPayload = { ...baseStaffPayload };
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

          return res.status(201).json({
            success: true,
            message: 'スタッフおよび認証アカウントを正常に作成しました。',
            staff: newStaff,
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
          } = effectivePayload;

          const targetStaffId = staffId || userId;
          if (!targetStaffId) {
            return res.status(400).json({ error: 'staffId または userId が必要です。' });
          }

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
          if (no_holiday !== undefined) {
            staffUpdatePayload.no_holiday = !!no_holiday;
          } else if (holidaySetting !== undefined) {
            staffUpdatePayload.no_holiday = !!holidaySetting;
          }

          const { data: updatedStaff, error: staffUpdateErr } = await supabaseAdmin
            .from('staff')
            .update(staffUpdatePayload)
            .eq('id', targetStaffId)
            .select()
            .single();

          if (staffUpdateErr) {
            console.error('Staff Update Error:', staffUpdateErr);
            return res.status(500).json({ error: staffUpdateErr.message });
          }

          return res.status(200).json({
            success: true,
            message: 'スタッフ情報を更新しました。',
            staff: updatedStaff,
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

            return res.status(200).json({
              success: true,
              message: 'スタッフおよび認証アカウントを完全に削除しました。',
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
              })
              .or(`id.eq.${targetId},user_id.eq.${targetId}`)
              .select()
              .single();

            if (deactErr) {
              console.error('Staff Deactivate Error:', deactErr);
              return res.status(500).json({ error: deactErr.message });
            }

            return res.status(200).json({
              success: true,
              message: 'スタッフを無効化（ログイン停止）しました。',
              staff: updatedStaff,
            });
          }
        }

        default:
          return res.status(400).json({
            error: `不明なアクションです: ${currentAction}。有効なアクション: CREATE, UPDATE_INFO, UPDATE_PASSWORD, DELETE`,
          });
      }
    } catch (err: any) {
      console.error('Admin Staff API Error:', err);
      return res.status(500).json({ error: err.message || '内部サーバーエラーが発生しました。' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
