import { normalizeName } from './staffUtils';

// 確定済みステータスの重要度ランク（確定済み > 未承認 pending）
const getStatusRank = (status: any): number => {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'deleted' || s === '削除' || s === 'removed') return 5;
  if (s === 'rejected' || s === '却下') return 4;
  if (s === 'superseded') return 3;
  if (s === 'approved' || s === '承認') return 2;
  return 1; // pending / 申請中 / 空
};

const isFinalizedStatus = (status: any): boolean => getStatusRank(status) >= 2;
const isPendingStatus = (status: any): boolean => getStatusRank(status) === 1;

const BASE_WORK_OR_OFF_TYPES = new Set(['出勤', '日勤', '公休']);

// Helper to ensure only one request per person per day, prioritizing finalized status & manual edits
export const deduplicateRequests = (list: any[]) => {
  if (!Array.isArray(list)) return { cleanList: [], discardedIds: [] };
  const discardedIds: string[] = [];

  const getTime = (i: any) => {
    // 優先順位: 1.Top-level updatedAt, 2.Details updatedAt, 3.Top-level snake_case, 4.CreatedAt
    const t = i.updatedAt || (i.details && i.details.updatedAt) || i.updated_at || i.createdAt || i.created_at || 0;
    return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
  };

  const getPriority = (i: any) => i?.details?.priority || i?.priority || 0;

  const isLocked = (i: any) => i?.details?.locked === true || i?.locked === true;

  const isManual = (item: any) => {
    if (!item) return false;
    // 1. 明示的な boolean フラグを最優先
    if (item.is_manual === true || item.isManual === true || item.details?.isManual === true) return true;
    if (item.is_manual === false || item.isManual === false || item.details?.isManual === false || item.details?.isAuto === true) return false;

    const idStr = String(item.id || '');
    const note = String(item.details?.note || '');
    const reason = String(item.reason || '');

    // 2. レガシー接頭辞のフォールバック
    if (idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('off-') || idStr.startsWith('u-') || idStr.startsWith('req-')) return true;

    // 自動系IDでも、内容が変更されていれば手動扱いとする
    if (idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-') || idStr.startsWith('aw_')) {
      if (note !== '' && !note.includes('自動')) return true;
      if (reason !== '' && !reason.includes('自動')) return true;
      return false;
    }

    return true; // その他は安全のため手動扱い
  };

  // 【フェーズ1】同一 ID のレコードが重複している場合、確定済みステータス（deleted/rejected/superseded/approved）を pending より絶対優先
  const byIdMap = new Map<string, any>();
  const noIdItems: any[] = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item) continue;
    const cleanId = item.id ? String(item.id).replace(/['"]/g, '').trim() : '';
    if (!cleanId) {
      noIdItems.push(item);
      continue;
    }
    const prev = byIdMap.get(cleanId);
    if (!prev) {
      byIdMap.set(cleanId, item);
    } else {
      const rankNew = getStatusRank(item.status);
      const rankOld = getStatusRank(prev.status);
      if (rankNew > rankOld) {
        byIdMap.set(cleanId, item);
      } else if (rankNew === rankOld && getTime(item) >= getTime(prev)) {
        byIdMap.set(cleanId, item);
      }
    }
  }

  const idDedupedList = [...Array.from(byIdMap.values()), ...noIdItems];

  // 【フェーズ2】同一スタッフ・同一日付での重複解決
  const map = new Map<string, any>();

  idDedupedList.forEach(item => {
    if (!item) return;

    // Fallback for legacy snake_case data from older versions or direct DB access
    if (!item.staffName && item.staff_name) {
      item.staffName = item.staff_name;
    }

    if (!item.staffName || !item.date) return;
    if (item.status === 'deleted' || item.status === '削除' || item.status === 'removed') {
      if (item.id) discardedIds.push(item.id);
      return;
    }

    // [V74.4] UUIDによる鍵生成を優先しつつ、救済ロジックとID移行措置
    let sId = (item.staffId || item.staff_id || item.userId || item.user_id || '').trim();

    // 佐藤公貴さんのID移行に伴う救済措置 (OLD -> NEW)
    if (sId === '70eb22b7-90a1-46b8-b120-0b9e67121e61') {
      sId = '902d91d7-3ae9-4b5e-8db3-a08f33c4ec7b';
    }
    // 藤森さんのID移行に伴う救済措置 (OLD -> NEW)
    if (sId === '8b7acf55-bfae-4007-bada-86b06ce264a0' || sId === 'b269fc7b-a386-41c8-b31b-b856a2ff560f') {
      sId = '0f2d8ce4-ccad-471c-9e29-bccec79b1b4e';
    }

    const key = sId ? `${sId}-${item.date}` : `${normalizeName(item.staffName || '')}-${item.date}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      return;
    }

    const isLockNew = isLocked(item);
    const wasLockOld = isLocked(existing);
    const isManNew = isManual(item);
    const wasManOld = isManual(existing);
    const priorityNew = getPriority(item);
    const priorityOld = getPriority(existing);
    const rankNew = getStatusRank(item.status);
    const rankOld = getStatusRank(existing.status);
    const sameType = String(item.type || '').trim() === String(existing.type || '').trim();

    let isPriority = false;

    // 0. 【最優先ガード】確定済みステータス vs 未承認(pending) の解決
    //    - 自動生成の基本シフト（出勤/日勤/公休）に対してスタッフが新規提出した休暇申請(pending)は潰さず残す
    //    - それ以外（同種別、または手動確定・承認済み休暇と同居している重複 pending）では、確定済みステータスを必ず優先する
    const isNewAutoBaseShift = !isManNew && BASE_WORK_OR_OFF_TYPES.has(String(item.type || '').trim());
    const isOldAutoBaseShift = !wasManOld && BASE_WORK_OR_OFF_TYPES.has(String(existing.type || '').trim());
    const isNewLeavePending = isPendingStatus(item.status) && !BASE_WORK_OR_OFF_TYPES.has(String(item.type || '').trim());
    const isOldLeavePending = isPendingStatus(existing.status) && !BASE_WORK_OR_OFF_TYPES.has(String(existing.type || '').trim());

    if (isNewLeavePending && isOldAutoBaseShift) {
      // 自動生成の出勤/公休に対して新規に提出された休暇申請(pending)は承認待ちとして残す
      isPriority = true;
    } else if (isOldLeavePending && isNewAutoBaseShift) {
      // 既に承認待ちの休暇申請がある日に自動生成の出勤/公休が来ても上書きしない
      isPriority = false;
    } else if (isFinalizedStatus(item.status) && isPendingStatus(existing.status)) {
      // 確定済みステータス（approved / rejected / superseded）を pending より必ず優先
      isPriority = true;
    } else if (isPendingStatus(item.status) && isFinalizedStatus(existing.status)) {
      // 既存の確定済みステータスを pending で上書きしない
      isPriority = false;
    }
    // 1. ロック優先
    else if (isLockNew && !wasLockOld) {
      isPriority = true;
    } else if (!isLockNew && wasLockOld) {
      isPriority = false;
    }
    // 2. 明示的な優先度 (priority) 優先
    else if (priorityNew !== priorityOld) {
      isPriority = priorityNew > priorityOld;
    }
    // 3. 手動優先
    else if (isManNew && !wasManOld) {
      isPriority = true; // 手動は常に自動を上書き
    } else if (!isManNew && wasManOld) {
      isPriority = false; // 自動は手動を上書きできない
    }
    // 4. ステータス確定度優先（両方確定済みの場合、rejected / superseded > approved）
    else if (rankNew !== rankOld) {
      isPriority = rankNew > rankOld;
    }
    // 5. 更新時間優先 (最新の入力を優先)
    else {
      const timeNew = getTime(item);
      const timeOld = getTime(existing);

      if (timeNew !== timeOld) {
        isPriority = timeNew > timeOld;
      } else {
        const isAppNew = item.status === 'approved' || item.status === '承認' || item.is_manual === true || item.isManual === true;
        const isAppOld = existing.status === 'approved' || existing.status === '承認' || existing.is_manual === true || existing.isManual === true;
        if (isAppNew && !isAppOld) {
          isPriority = true;
        } else if (!isAppNew && isAppOld) {
          isPriority = false;
        } else {
          isPriority = true;
        }
      }
    }

    if (isPriority) {
      if (existing.id !== item.id && existing.id) discardedIds.push(existing.id);
      map.set(key, item);
    } else {
      if (item.id !== existing.id && item.id) discardedIds.push(item.id);
    }
  });

  const cleanList = Array.from(map.values());
  return { cleanList, discardedIds };
};
