import { normalizeName } from './staffUtils';

// Helper to ensure only one request per person per day, prioritizing manual edits
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

  const map = new Map();
  list.forEach(item => {
    if (!item) return;
    
    // Fallback for legacy snake_case data from older versions or direct DB access
    if (!item.staffName && item.staff_name) {
      item.staffName = item.staff_name;
    }

    if (!item.staffName || !item.date) return;
    if (item.status === 'deleted' || item.status === 'removed') {
      discardedIds.push(item.id);
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

    const keyBase = sId ? `${sId}-${item.date}` : `${normalizeName(item.staffName || '')}-${item.date}`;
    // 同日・同一スタッフにつき、最新の修正/更新が過去の古い入力を優先上書きするよう同一キー化
    const key = keyBase;
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

    let isPriority = false;

    // 1. ロック優先
    if (isLockNew && !wasLockOld) {
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
    // 4. 更新時間優先 (最新の入力を優先)
    else {
      const timeNew = getTime(item);
      const timeOld = getTime(existing);
      
      if (timeNew !== timeOld) {
        isPriority = timeNew > timeOld;
      } else {
        // 時刻が全く同じ場合、ステータスが承認済みのものを優先
        if (item.status === 'approved' && existing.status !== 'approved') {
          isPriority = true;
        } else if (item.status !== 'approved' && existing.status === 'approved') {
          isPriority = false;
        } else {
          // それでも決着がつかない場合は、手動優先、次に更新時間優先
          if (isManNew && !wasManOld) {
            isPriority = true;
          } else if (!isManNew && wasManOld) {
            isPriority = false;
          } else {
            isPriority = true;
          }
        }
      }
    }

    if (isPriority) {
      if (existing.id !== item.id) discardedIds.push(existing.id);
      map.set(key, item);
    } else {
      if (item.id !== existing.id) discardedIds.push(item.id);
    }
  });

  const cleanList = Array.from(map.values());
  return { cleanList, discardedIds };
};
