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
    const idStr = String(item.id || '');
    const note = String(item.details?.note || '');
    const reason = String(item.reason || '');

    // 【最優先】手動系ID接頭辞
    if (idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('off-') || idStr.startsWith('u-')) return true;

    // 自動系IDでも、内容が変更されていれば手動扱いとする
    if (idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-')) {
      if (note !== '' && !note.includes('自動')) return true;
      if (reason !== '' && !reason.includes('自動')) return true;
      if (item.isManual === true) return true; // 明示的なフラグがあれば尊重
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
    
    const keyBase = `${normalizeName(item.staffName)}-${item.date}`;
    // 時間給は「daily」の枠とは別に保持できるようにする
    const isHourly = item.type === '時間給';
    const key = `${keyBase}-${isHourly ? 'hourly-' + item.id : 'daily'}`;
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
      isPriority = true;
    } else if (!isManNew && wasManOld) {
      isPriority = false;
    } 
    // 4. 更新時間優先
    else {
      const timeNew = getTime(item);
      const timeOld = getTime(existing);
      
      isPriority = timeNew > timeOld;
      
      // ステータスが承認済みのものを優先（時間が同じ場合）
      if (timeNew === timeOld && !isPriority) {
        isPriority = (item.status === 'approved' && existing.status !== 'approved');
      }
    }

    if (isPriority) {
      if (existing.id !== item.id) discardedIds.push(existing.id);
      map.set(key, item);
    } else {
      if (item.id !== existing.id) discardedIds.push(item.id);
    }
  });

  // 修正後の2次パス: 同一日の「daily」な手動申請がある場合、自動生成分を削除
  const tempResults = Array.from(map.values());
  const dailyManuals = new Set();
  tempResults.forEach(r => { 
    if (r.type !== '時間給' && isManual(r)) {
      dailyManuals.add(`${normalizeName(r.staffName)}-${r.date}`);
    } 
  });

  const cleanList = tempResults.filter(r => {
    if (r.type !== '時間給' && !isManual(r) && dailyManuals.has(`${normalizeName(r.staffName)}-${r.date}`)) {
      if (!discardedIds.includes(r.id)) discardedIds.push(r.id);
      return false;
    }
    return true;
  });

  return { cleanList, discardedIds };
};
