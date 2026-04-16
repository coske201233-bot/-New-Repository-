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
    let toUpsert: any[] = [];
    let toDelete: string[] = [];
    let finalCleanList: any[] = [];

    // 1. Calculate the new state synchronously based on previous state
    setRequests(prev => {
      const nextRaw = typeof update === 'function' ? update(prev) : update;
      
      const nextWithMeta = nextRaw.map(r => {
        const old = prev.find(o => o.id === r.id);
        
        // 変更検知の強化: 全体の内容を比較（簡易的なJSON比較）
        // ただし updatedAt 自体の違いは無視して判定する
        const cleanOld = old ? { ...old, updatedAt: undefined } : null;
        const cleanNew = { ...r, updatedAt: undefined };
        const isChanged = !old || JSON.stringify(cleanOld) !== JSON.stringify(cleanNew);

        if (isChanged) {
          const now = new Date().toISOString();
          return { 
            ...r, 
            updatedAt: now,
            details: {
              ...(r.details || {}),
              updatedAt: now // details内にも二重保持して確実にDBへ渡す
            },
            source: isMobileDevice() ? 'mobile' : 'web'
          };
        }
        return r;
      });

      const { cleanList, discardedIds } = deduplicateRequests(nextWithMeta);
      
      // Identify what needs to be synced to cloud
      toUpsert = cleanList.filter(nr => {
        const old = prev.find(o => o.id === nr.id);
        return !old || old.updatedAt !== nr.updatedAt;
      });
      
      toDelete = discardedIds;
      finalCleanList = cleanList;
      
      return cleanList;
    });

    // 2. Perform side effects AFTER the state update logic
    try {
      await saveData(STORAGE_KEYS.REQUESTS, finalCleanList);
      
      if (toUpsert.length > 0) {
        await cloudStorage.upsertRequests(toUpsert);
      }
      if (toDelete.length > 0) {
        await cloudStorage.deleteRequests(toDelete);
      }
    } catch (e) {
      console.error('Async storage/cloud update error:', e);
    }
  }, []);

  // クラウドからのデータを安全にマージする
  const mergeCloudRequests = useCallback(async (cloudReqs: any[]) => {
    setRequests(current => {
      const combined = [...current, ...cloudReqs];
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
    mergeCloudRequests
  }), [requests, requestsHistory, updateRequests, mergeCloudRequests]);
};
