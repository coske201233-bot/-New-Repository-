import { supabase } from './supabase';

// 申請の削除（キャンセル）
export const deleteShiftRequest = async (requestId: string) => {
  if (!requestId) throw new Error('申請IDが見つかりません');
  const cleanId = String(requestId).replace(/['"]/g, '').trim();

  // 申請情報の事前取得
  const { data: req } = await supabase
    .from('requests')
    .select('id, staff_id, date')
    .filter('id', 'eq', cleanId)
    .maybeSingle();

  // requests から削除
  const { error: delErr } = await supabase
    .from('requests')
    .delete()
    .filter('id', 'eq', cleanId);

  if (delErr) throw delErr;

  // 連動する shifts も削除
  if (req?.staff_id && req?.date) {
    await supabase
      .from('shifts')
      .delete()
      .match({ staff_id: req.staff_id, date: req.date });
  }

  return true;
};

// 申請のステータス更新（承認・却下）
export const updateRequestStatus = async (
  requestId: string,
  status: '承認' | '却下' | '申請中' | 'approved' | 'rejected' | 'pending' | string
) => {
  if (!requestId) throw new Error('申請IDが見つかりません');
  const cleanId = String(requestId).replace(/['"]/g, '').trim();

  const { data, error } = await supabase
    .from('requests')
    .update({ status })
    .filter('id', 'eq', cleanId)
    .select();

  if (error) throw error;
  return data;
};


