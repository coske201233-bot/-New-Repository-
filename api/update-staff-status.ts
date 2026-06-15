import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

/**
 * 管理者によるスタッフの情報・ステータス更新用 API
 * POST /api/update-staff-status
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { staffId, payload } = req.body;

  if (!staffId || !payload) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
  const supabaseServiceKey = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration error: Service Role Key missing' });
  }

  // サーバーサイド（Protected Environment）のため、service_roleキーを使って安全に初期化
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    // 厳密なUUID（staffId）を用いてレコードを直撃更新
    const { data, error } = await supabaseAdmin
      .from('staff')
      .update(payload)
      .eq('id', staffId)
      .select();

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error("SERVER SIDE UPDATE ERROR:", error);
    return res.status(500).json({ error: error.message || 'Failed to update staff' });
  }
}
