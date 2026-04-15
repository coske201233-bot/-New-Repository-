import { useState, useEffect } from 'react';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage } from '../utils/cloudStorage';
import { deduplicateRequests } from '../utils/requestUtils';

export const useRequestData = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [requestsHistory, setRequestsHistory] = useState<any[][]>([]);

  useEffect(() => {
    const load = async () => {
      const lr = await loadData(STORAGE_KEYS.REQUESTS);
      if (lr) setRequests(lr);
    };
    load();
  }, []);

  const updateRequests = async (update: any[] | ((prev: any[]) => any[])) => {
    const prev = requests;
    const next = typeof update === 'function' ? update(prev) : update;
    const { cleanList, discardedIds } = deduplicateRequests(next);
    setRequests(cleanList);
    await saveData(STORAGE_KEYS.REQUESTS, cleanList);
    const changed = cleanList.filter(nr => {
      const old = prev.find(o => o.id === nr.id);
      return !old || old.type !== nr.type || old.status !== nr.status;
    });
    // クラウドに変更分を送信し、破棄分を削除
    if (changed.length > 0) await cloudStorage.upsertRequests(changed);
    if (discardedIds.length > 0) {
      console.log('Cleaning up discarded requests from cloud:', discardedIds.length);
      await cloudStorage.deleteRequests(discardedIds).catch(e => console.error('Cloud cleanup error:', e));
    }
  };

  return { requests, setRequests, requestsHistory, setRequestsHistory, updateRequests };
};
