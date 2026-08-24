import { supabase } from './supabase';

/**
 * シフト希望（requests）の削除および関連シフト（shifts）の連動削除処理
 *
 * @param requestId 削除対象の申請ID
 */
export const deleteShiftRequest = async (requestId: string) => {
  if (!requestId) {
    throw new Error('削除対象の申請IDが存在しません。');
  }

  // UUID形式の文字列であることを確認（前後の空白等を除去）
  const cleanId = String(requestId).trim();

  // 1. 削除前に該当の申請データ（staff_id と date）を取得
  const { data: targetRequest, error: fetchErr } = await supabase
    .from('requests')
    .select('id, staff_id, date')
    .eq('id', cleanId)
    .maybeSingle();

  if (fetchErr) {
    console.error('申請データの事前取得エラー:', fetchErr);
  }

  // 2. requests テーブルから該当申請を削除
  const { data, error } = await supabase
    .from('requests')
    .delete()
    .eq('id', cleanId);

  if (error) {
    console.error('Request Delete Error:', error);
    throw error;
  }

  // 3. 連動するシフト（shifts）が存在する場合、staff_id と date の組み合わせで特定して削除
  if (targetRequest?.staff_id && targetRequest?.date) {
    const { error: shiftError } = await supabase
      .from('shifts')
      .delete()
      .match({
        staff_id: targetRequest.staff_id,
        date: targetRequest.date,
      });

    if (shiftError) {
      console.warn('Shift Sync Delete Warning (シフトの連動削除スキップまたは警告):', shiftError.message);
    }
  }

  return data;
};

