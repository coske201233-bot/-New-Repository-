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

    // 【最優先】手動系ID接頭辞（req- は staff申請IDのため手動扱い）
    if (idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('off-') || idStr.startsWith('u-') || idStr.startsWith('req-')) return true;

    // 自動系IDでも、内容が変更されていれば手動扱いとする
    if (idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-') || idStr.startsWith('aw_')) {
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
    
    // [V74.4] UUIDによる鍵生成を優先しつつ、救済ロジックとID移行措置
    let sId = (item.staffId || item.staff_id || item.userId || item.user_id || '').trim();
    
    // 佐藤公貴さんのID移行に伴う救済措置 (OLD -> NEW)
    if (sId === '70eb22b7-90a1-46b8-b120-0b9e67121e61') {
      sId = '902d91d7-3ae9-4b5e-8db3-a08f33c4ec7b';
    }

    const keyBase = sId ? `${sId}-${item.date}` : `${normalizeName(item.staffName || '')}-${item.date}`;
    
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
      isPriority = true; // 手動は常に自動を上書き
    } else if (!isManNew && wasManOld) {
      isPriority = false; // 自動は手動を上書きできない
    } 
    // 4. 更新時間優先 (同じ「手動」同士、または同じ「自動」同士の場合)
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
          // それでも決着がつかない場合は、管理者による手動調整 (m-) を最優先、次にモバイル申請 (req-)
          const isMNew = String(item.id).startsWith('m-');
          const isMOld = String(existing.id).startsWith('m-');
          if (isMNew && !isMOld) {
            isPriority = true;
          } else if (!isMNew && isMOld) {
            isPriority = false;
          } else {
            isPriority = String(item.id).startsWith('req-');
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

  // 修正後の2次パス: 優先順位の低いデータを一括排除
  const tempResults = Array.from(map.values());
  const dailyManuals = new Set(); // m- (管理者調整)
  const dailyRequests = new Set(); // req- (モバイル申請)

  tempResults.forEach(r => { 
    const sId = (r.staffId || r.staff_id || r.userId || r.user_id || '').trim();
    const key = sId ? `${sId}-${r.date}` : `${normalizeName(r.staffName || '')}-${r.date}`;
    if (r.type !== '時間給') {
      if (String(r.id).startsWith('m-')) {
        dailyManuals.add(key);
      } else if (isManual(r)) {
        dailyRequests.add(key);
      }
    } 
  });

  const cleanList = tempResults.filter(r => {
    if (r.type === '時間給') return true;
    const sId = (r.staffId || r.staff_id || r.userId || r.user_id || '').trim();
    const key = sId ? `${sId}-${r.date}` : `${normalizeName(r.staffName || '')}-${r.date}`;
    
    // 1. 管理者調整 (m-) がある場合、それ以外のすべての同日データ (req-, auto-) を排除
    if (!String(r.id).startsWith('m-') && dailyManuals.has(key)) {
      if (!discardedIds.includes(r.id)) discardedIds.push(r.id);
      return false;
    }
    
    // 2. 手動申請 (req-) がある場合、自動生成 (auto-) を排除
    if (!isManual(r) && (dailyManuals.has(key) || dailyRequests.has(key))) {
      if (!discardedIds.includes(r.id)) discardedIds.push(r.id);
      return false;
    }
    
    return true;
  });

  return { cleanList, discardedIds };
};
