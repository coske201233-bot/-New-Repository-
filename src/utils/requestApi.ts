import { supabase } from './supabase';
import { recordAuditLog } from './auditLogger';

// 申請の削除（キャンセル）
export const deleteShiftRequest = async (
  requestId: string,
  operator?: { id?: string; name?: string }
) => {
  if (!requestId) throw new Error('申請IDが見つかりません');
  const cleanId = String(requestId).replace(/['"]/g, '').trim();

  // 申請情報の事前取得（ログ記録用）
  const { data: req } = await supabase
    .from('requests')
    .select('*')
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

  // 監査ログの記録
  if (req) {
    await recordAuditLog({
      operatorId: operator?.id,
      operatorName: operator?.name || 'システム',
      targetStaffId: req.staff_id,
      targetStaffName: req.staff_name,
      actionType: 'REQUEST_DELETE',
      targetDate: req.date,
      details: `${req.staff_name || 'スタッフ'}さんの申請「${req.type || '申請'}」(${req.date || ''}) を削除しました`,
      beforeData: req,
      afterData: null,
    });
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

/**
 * 申請の承認処理（公休変更・休日出勤変更・ダブルペア・単一日申請のshiftsテーブル完全同期対応）
 */
export const approveShiftRequest = async (
  requestIdOrObj: string | any,
  status: 'approved' | 'rejected' | 'pending' | string = 'approved',
  operator?: { id?: string; name?: string }
) => {
  let req: any = typeof requestIdOrObj === 'object' ? { ...requestIdOrObj } : null;
  const requestId = typeof requestIdOrObj === 'string' ? requestIdOrObj : requestIdOrObj?.id;
  if (!requestId) throw new Error('申請IDが見つかりません');
  const cleanId = String(requestId).replace(/['"]/g, '').trim();

  if (!req || !req.type) {
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .filter('id', 'eq', cleanId)
      .maybeSingle();
    if (error) throw error;
    req = data;
  }

  if (!req) throw new Error('対象の申請レコードが見つかりません');

  const now = new Date().toISOString();
  const updatedReq = {
    ...req,
    status,
    updatedAt: now,
    updated_at: now
  };

  // 1. requests テーブルの更新
  const { error: updateErr } = await supabase
    .from('requests')
    .update({
      status,
      details: { ...(req.details || {}), updatedAt: now }
    })
    .filter('id', 'eq', cleanId);

  if (updateErr) throw updateErr;

  // 2. shifts テーブルの連動同期
  const isApprove = status === 'approved' || status === '承認';
  const isReject = status === 'rejected' || status === '却下';
  const targetStaffId = req.staff_id || req.staffId || req.user_id || req.userId;
  const targetStaffName = req.staff_name || req.staffName;

  // 指定日の既存シフトを確実にDELETEするヘルパー（ID不一致による公休ゾンビの残存を物理的に排除）
  const clearShiftsForDate = async (date: string) => {
    if (!date) return;
    if (targetStaffId) {
      await supabase
        .from('shifts')
        .delete()
        .eq('staff_id', targetStaffId)
        .eq('date', date);
    }
    if (targetStaffName) {
      await supabase
        .from('shifts')
        .delete()
        .eq('staff_name', targetStaffName)
        .eq('date', date);
    }
  };

  // shifts テーブルへ登録するヘルパー
  const insertShiftRecord = async (payload: {
    date: string;
    type: string;
    hours?: number;
    details?: any;
  }) => {
    if (!payload.date) return;

    // UUIDエラーを避けるため、合成文字列IDは使わず有効なUUIDを生成またはDB自動生成に任せる
    const shiftData: any = {
      staff_id: targetStaffId,
      staff_name: targetStaffName,
      date: payload.date,
      type: payload.type,
      status: 'approved',
      is_manual: true,
      hours: payload.hours,
      details: payload.details,
      created_at: now
    };

    // 環境に応じて crypto.randomUUID() を設定、または insert 実行
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      shiftData.id = crypto.randomUUID();
    }

    const { error: shiftErr } = await supabase
      .from('shifts')
      .insert([shiftData]);

    if (shiftErr) {
      console.error('shifts insert error in approveShiftRequest:', shiftErr);
      throw shiftErr;
    }
  };

  if (isApprove) {
    if (req.type === '公休変更') {
      const originalDate = req.details?.originalDate || req.originalDate || req.old_date;
      const targetDate = req.details?.targetDate || req.targetDate || req.new_date || req.date;

      // ① 変更元（originalDate）：既存の公休シフトを削除し、出勤（稼働）として登録
      if (originalDate) {
        await clearShiftsForDate(originalDate);
        await insertShiftRecord({
          date: originalDate,
          type: '出勤',
          details: { note: '公休変更に伴う出勤化' }
        });
      }

      // ② 変更先（targetDate）：既存シフトを削除し、公休として登録
      if (targetDate) {
        await clearShiftsForDate(targetDate);
        await insertShiftRecord({
          date: targetDate,
          type: '公休',
          details: req.details
        });
      }
    } else if (req.type === '休日出勤変更') {
      const originalDate = req.details?.originalDate || req.originalDate || req.old_date;
      const targetDate = req.details?.targetDate || req.targetDate || req.new_date || req.date;

      // ① 変更元（originalDate）：休日出勤取りやめ -> 公休へ
      if (originalDate) {
        await clearShiftsForDate(originalDate);
        await insertShiftRecord({
          date: originalDate,
          type: '公休',
          details: { note: '休日出勤変更に伴う公休化' }
        });
      }

      // ② 変更先（targetDate）：新規休日出勤 -> 休日出勤へ
      if (targetDate) {
        await clearShiftsForDate(targetDate);
        await insertShiftRecord({
          date: targetDate,
          type: '休日出勤',
          details: req.details
        });
      }
    } else if (req.type === '休日出勤＋公休変更') {
      // ダブルペア
      const workOriginalDate = req.details?.workOriginalDate || req.workOriginalDate;
      const workTargetDate = req.details?.workTargetDate || req.workTargetDate;
      const offOriginalDate = req.details?.offOriginalDate || req.offOriginalDate;
      const offTargetDate = req.details?.offTargetDate || req.offTargetDate;

      // 休日出勤ペア: 元日は公休へ、新日は休日出勤へ
      if (workOriginalDate) {
        await clearShiftsForDate(workOriginalDate);
        await insertShiftRecord({ date: workOriginalDate, type: '公休' });
      }
      if (workTargetDate) {
        await clearShiftsForDate(workTargetDate);
        await insertShiftRecord({ date: workTargetDate, type: '休日出勤' });
      }

      // 公休ペア: 元日は出勤へ、新日は公休へ
      if (offOriginalDate) {
        await clearShiftsForDate(offOriginalDate);
        await insertShiftRecord({ date: offOriginalDate, type: '出勤' });
      }
      if (offTargetDate) {
        await clearShiftsForDate(offTargetDate);
        await insertShiftRecord({ date: offTargetDate, type: '公休' });
      }
    } else {
      // 単一日の休暇申請（年休、特休、時間休、振替、午前休、午後休など）
      if (req.date) {
        await clearShiftsForDate(req.date);
        await insertShiftRecord({
          date: req.date,
          type: req.type,
          hours: req.hours ?? req.details?.hours ?? req.details?.duration,
          details: req.details
        });
      }
    }
  } else if (isReject) {
    // 却下時：申請に伴って shifts に作成されていた仮レコードを削除
    if (req.date) {
      await clearShiftsForDate(req.date);
    }
  }

  // 3. 監査ログ記録
  await recordAuditLog({
    operatorId: operator?.id,
    operatorName: operator?.name || '管理者',
    targetStaffId: req.staff_id || req.staffId || req.user_id,
    targetStaffName: req.staff_name || req.staffName,
    actionType: isReject ? 'REQUEST_REJECT' : 'REQUEST_APPROVE',
    targetDate: req.date,
    details: `${req.staff_name || req.staffName || 'スタッフ'}さんの申請「${req.type || '申請'}」(${req.date || ''}) を${isReject ? '却下' : '承認'}しました`,
    beforeData: req,
    afterData: updatedReq
  });

  return updatedReq;
};

/**
 * 複数申請の一括承認処理
 */
export const bulkApproveShiftRequests = async (
  requestIds: string[],
  operator?: { id?: string; name?: string }
) => {
  if (!requestIds || requestIds.length === 0) return;
  for (const id of requestIds) {
    await approveShiftRequest(id, 'approved', operator);
  }
};
