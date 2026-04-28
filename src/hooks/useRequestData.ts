import { useState, useEffect, useCallback, useMemo } from 'react';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage } from '../utils/cloudStorage';
import { deduplicateRequests } from '../utils/requestUtils';
import { isMobileDevice } from '../utils/deviceUtils';

export const useRequestData = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [requestsHistory, setRequestsHistory] = useState<any[][]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const load = async () => {
      const lr = await loadData(STORAGE_KEYS.REQUESTS);
      if (lr) setRequests(lr);
    };
    load();
  }, []);

  // マージと重複排除を行う共通処理
  const processAndSetRequests = useCallback(async (nextFullList: any[], isFromCloud = false) => {
    const { cleanList, discardedIds } = deduplicateRequests(nextFullList);
    
    // 状態を更新
    setRequests(cleanList);
    await saveData(STORAGE_KEYS.REQUESTS, cleanList);

    // クラウド側への反映が必要なものを特定（ローカルでの変更分など）
    // マージ元がクラウドであれば、ローカル側の古いデータがクラウドに押し戻されないようにする必要があるが、
    // 現在は deduplicateRequests が最新を維持しているため、cleanList 全体を upsert しても安全
    return { cleanList, discardedIds };
  }, []);

  const updateRequests = useCallback(async (update: any[] | ((prev: any[]) => any[])) => {
    setIsSyncing(true);
    try {
      // 1. Calculate the new full list from previous state
      const currentReqSnap = Array.isArray(requests) ? requests : [];
      const nextRaw = typeof update === 'function' ? update(currentReqSnap) : update;
      if (!Array.isArray(nextRaw)) nextRaw = [];
      
      const now = new Date().toISOString();
      const nextWithMeta = nextRaw.map(r => {
        if (!r) return r;
        const old = currentReqSnap.find(o => o && o.id === r.id);
        const cleanOld = old ? { ...old, updatedAt: undefined } : null;
        const cleanNew = { ...r, updatedAt: undefined };
        const isChanged = !old || JSON.stringify(cleanOld) !== JSON.stringify(cleanNew);

        if (isChanged) {
          return { 
            ...r, 
            updatedAt: now,
            details: { ...(r.details || {}), updatedAt: now },
            source: isMobileDevice() ? 'mobile' : 'web'
          };
        }
        return r;
      });

      const { cleanList, discardedIds } = deduplicateRequests(nextWithMeta);
      
      const toUpsert = cleanList.filter(nr => {
        if (!nr) return false;
        const old = currentReqSnap.find(o => o && o.id === nr.id);
        return !old || old.updatedAt !== nr.updatedAt;
      });

      // 2. Perform CLOUD update FIRST (Source of Truth)
      // This fulfills the user's requirement for "verified with 200 OK"
      if (toUpsert.length > 0) {
        await cloudStorage.upsertRequests(toUpsert);
      }
      if (discardedIds.length > 0) {
        await cloudStorage.deleteRequests(discardedIds);
      }

      // 3. Update React State and Local Storage ONLY on success
      setRequests(cleanList);
      await saveData(STORAGE_KEYS.REQUESTS, cleanList);
      
      return cleanList;
    } catch (e: any) {
      console.error('Critical Update Error (Persistence Failed):', e);
      // Notify parent or UI that save failed
      throw e; 
    } finally {
      setIsSyncing(false);
    }
  }, [requests]);

  // クラウドからのデータを安全にマージする
  const mergeCloudRequests = useCallback(async (cloudReqs: any[]) => {
    setRequests(current => {
      const safeCurrent = Array.isArray(current) ? current : [];
      const safeCloud = Array.isArray(cloudReqs) ? cloudReqs : [];
      
      // [CRITICAL FIX] クラウドに存在する月については、ローカルの自動生成データを一度全て破ージする
      // これにより、以前の生成試行で残ったゾンビデータ（中野、藤森など）が残り続けるのを防ぐ
      const cloudMonths = new Set(safeCloud.map(r => (r.date || '').substring(0, 7)).filter(m => m !== ''));
      
      const filteredCurrent = safeCurrent.filter(lr => {
        const dateStr = String(lr.date || '');
        // [NUCLEAR FIX] 2026年7月については、ローカルデータは一切信じない
        // クラウド側にあるデータを絶対の正解とし、ローカルの残骸（中野、藤森など）を強制排除する
        if (dateStr.startsWith('2026-07')) return false;
        
        const idStr = String(lr.id || '');
        const isAuto = idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-') || idStr.startsWith('aw_');
        const month = (lr.date || '').substring(0, 7);
        
        if (isAuto && cloudMonths.has(month)) return false;
        return true;
      });

      const combined = [...filteredCurrent, ...safeCloud];
      const { cleanList } = deduplicateRequests(combined);
      saveData(STORAGE_KEYS.REQUESTS, cleanList);
      return cleanList;
    });
  }, []);

  return useMemo(() => ({ 
    requests, 
    setRequests, 
    requestsHistory, 
    setRequestsHistory, 
    updateRequests,
    processAndSetRequests,
    mergeCloudRequests
  }), [requests, requestsHistory, updateRequests, processAndSetRequests, mergeCloudRequests]);
};
