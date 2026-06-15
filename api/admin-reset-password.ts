import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

/**
 * 管理者によるスタッフのパスワードリセット用 API
 * POST /api/admin-reset-password
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const authHeader = req.headers.authorization;
  const { targetUserId, newPassword } = req.body;

  if (!authHeader || !targetUserId || !newPassword) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  // ✨ 先頭に EXPO_PUBLIC_ を付けた変数から取得するように修正します
  const supabaseServiceKey = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || '';

  // 💡 厳密な存在チェック（未定義エラーによるクラッシュを防ぎます）
  if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Supabase credentials missing: URLまたはService Role Keyが設定されていません。');
      return res.status(500).json({ error: 'Database configuration missing' });
    }

  // 💡 一般用クライアント
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // ✨ 特権用クライアント
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  if (!supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration error: Service Role Key is missing.' });
  }

  // 1. 標準クライアントでリクエスタの権限を確認
  const token = authHeader.replace('Bearer ', '');
  
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid session.' });
  }

  // 2. staff テーブルを参照して管理職かどうかを確認
  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .single();

  const isAdmin = staff?.role?.includes('管理者') || staff?.role?.includes('開発者');

  if (!isAdmin) {
    return res.status(403).json({ error: 'Forbidden: Admin privileges required.' });
  }

  const { data: updateData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    targetUserId,
    { password: newPassword }
  );

  if (updateError) {
    console.error('Admin password reset error:', updateError);
    return res.status(500).json({ error: updateError.message });
  }

  return res.status(200).json({ success: true, message: 'Password updated successfully' });
}
