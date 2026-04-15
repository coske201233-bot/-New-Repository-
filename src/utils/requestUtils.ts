import { normalizeName } from './staffUtils';

// Helper to ensure only one request per person per day, prioritizing manual edits
export const deduplicateRequests = (list: any[]) => {
  if (!Array.isArray(list)) return { cleanList: [], discardedIds: [] };
  const discardedIds: string[] = [];
  
  const getTime = (i: any) => {
    const t = i.updatedAt || i.updated_at || i.createdAt || i.created_at || 0;
    return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
  };

  const isLocked = (i: any) => i?.details?.locked === true || i?.locked === true;

  const isManual = (item: any) => {
    if (!item) return false;
    const idStr = String(item.id || '');
    const note = String(item.details?.note || '');
    const reason = String(item.reason || '');

    // 【最優先】手動系ID接頭辞
    if (idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('off-')) return true;

    // 自動系IDでも、内容が変更されていれば手動扱いとする
    if (idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-')) {
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
    
    const key = `${normalizeName(item.staffName)}-${item.date}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      return;
    }

    const isLockNew = isLocked(item);
    const wasLockOld = isLocked(existing);
    const isManNew = isManual(item);
    const wasManOld = isManual(existing);

    let isPriority = false;

    // 1. ロック優先
    if (isLockNew && !wasLockOld) {
      isPriority = true;
    } else if (!isLockNew && wasLockOld) {
      isPriority = false;
    } 
    // 2. 手動優先
    else if (isManNew && !wasManOld) {
      isPriority = true;
    } else if (!isManNew && wasManOld) {
      isPriority = false;
    } 
    // 3. 更新時間優先
    else {
      const timeNew = getTime(item);
      const timeOld = getTime(existing);
      if (timeNew > timeOld) {
        isPriority = true;
      } else if (timeNew === timeOld) {
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

  // 2次パス: 手動（公休等）がある日は同じ日の自動（auto等）を排除
  const tempResults = Array.from(map.values());
  const dayManuals = new Set();
  tempResults.forEach(r => { if (isManual(r)) dayManuals.add(`${normalizeName(r.staffName)}-${r.date}`); });

  const cleanList = tempResults.filter(r => {
    if (dayManuals.has(`${normalizeName(r.staffName)}-${r.date}`) && !isManual(r)) {
      if (!discardedIds.includes(r.id)) discardedIds.push(r.id);
      return false;
    }
    return true;
  });

  return { cleanList, discardedIds };
};
