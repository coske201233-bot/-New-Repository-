import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage, getFetchDateRange, markLocalMutation } from '../utils/cloudStorage';
import { deduplicateRequests } from '../utils/requestUtils';
import { isMobileDevice } from '../utils/deviceUtils';
import { normalizeDateStr } from '../utils/dateUtils';

const normalizeReqName = (name: string) =>
  (name || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/公費/g, '').toUpperCase();

export interface RequestRemovalCriteria {
  id?: string;
  staffId?: string;
  staffName?: string;
  date?: string;
}

export interface FetchRequestsOptions {
  baseYear?: number;
  force?: boolean;
  merge?: boolean;
}

export const useRequestData = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [requestsHistory, setRequestsHistory] = useState<any[][]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const requestsRef = useRef<any[]>(requests);
  requestsRef.current = requests;

  const isFetchingRef = useRef(false);
  const lastFetchedAtRef = useRef<number>(0);
  const loadedYearRangeRef = useRef<{ minYear: number; maxYear: number } | null>(null);
  const saveTimerRef = useRef<any>(null);

  // 非同期・デバウンスで AsyncStorage へ永続化（メインスレッドのブロックを回避）
  const scheduleSaveRequests = useCallback((list: any[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveData(STORAGE_KEYS.REQUESTS, list).catch(() => {});
    }, 300);
  }, []);

  useEffect(() => {
    const load = async () => {
      const lr = await loadData(STORAGE_KEYS.REQUESTS);
      if (lr) setRequests(lr);
    };
    load();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // マージと重複排除を行う共通処理
  const processAndSetRequests = useCallback(async (nextFullList: any[], _isFromCloud = false) => {
    const { cleanList, discardedIds } = deduplicateRequests(nextFullList);

    // 状態を更新
    setRequests(cleanList);
    scheduleSaveRequests(cleanList);

    return { cleanList, discardedIds };
  }, [scheduleSaveRequests]);

  // 楽観的UI更新用: 変更・追加されたレコードのみをステートに即時マージ（O(N)）
  const upsertLocalRequests = useCallback((items: any[]) => {
    if (!Array.isArray(items) || items.length === 0) return;

    const normalizedItems = items.filter(Boolean).map(r => ({
      ...r,
      date: r.date ? normalizeDateStr(r.date) : r.date,
    }));
    if (normalizedItems.length === 0) return;

    const replaceIds = new Set<string>();
    const replaceStaffDate = new Set<string>();
    const replaceNameDate = new Set<string>();

    for (const r of normalizedItems) {
      if (r.id) replaceIds.add(String(r.id).trim());
      const d = normalizeDateStr(r.date);
      if (!d) continue;
      const sId = String(r.staff_id || r.staffId || r.user_id || r.userId || '').trim();
      const sName = normalizeReqName(r.staff_name || r.staffName || '');
      if (sId) replaceStaffDate.add(`${sId}_${d}`);
      if (sName) replaceNameDate.add(`${sName}_${d}`);
    }

    setRequests(prev => {
      const filtered = (Array.isArray(prev) ? prev : []).filter(existing => {
        if (!existing) return false;
        if (existing.id && replaceIds.has(String(existing.id).trim())) return false;
        const d = normalizeDateStr(existing.date);
        if (!d) return true;
        const eId = String(existing.staff_id || existing.staffId || existing.user_id || existing.userId || '').trim();
        const eName = normalizeReqName(existing.staff_name || existing.staffName || '');
        if (eId && replaceStaffDate.has(`${eId}_${d}`)) return false;
        if (eName && replaceNameDate.has(`${eName}_${d}`)) return false;
        return true;
      });
      const next = [...filtered, ...normalizedItems];
      scheduleSaveRequests(next);
      return next;
    });
  }, [scheduleSaveRequests]);

  // 楽観的UI更新用: 削除された申請レコードのみをステートから即時除外
  const removeLocalRequests = useCallback((criteriaList: RequestRemovalCriteria[]) => {
    if (!Array.isArray(criteriaList) || criteriaList.length === 0) return;

    const idsToRemove = new Set<string>();
    const staffDateToRemove = new Set<string>();
    const nameDateToRemove = new Set<string>();

    for (const c of criteriaList) {
      if (!c) continue;
      if (c.id) idsToRemove.add(String(c.id).replace(/['"]/g, '').trim());
      const d = normalizeDateStr(c.date);
      if (!d) continue;
      if (c.staffId) staffDateToRemove.add(`${String(c.staffId).trim()}_${d}`);
      if (c.staffName) {
        const n = normalizeReqName(c.staffName);
        if (n) nameDateToRemove.add(`${n}_${d}`);
      }
    }

    setRequests(prev => {
      const next = (Array.isArray(prev) ? prev : []).filter(existing => {
        if (!existing) return false;
        const cleanExistingId = String(existing.id || '').replace(/['"]/g, '').trim();
        if (cleanExistingId && idsToRemove.has(cleanExistingId)) return false;
        const d = normalizeDateStr(existing.date);
        if (!d) return true;
        const eId = String(existing.staff_id || existing.staffId || existing.user_id || existing.userId || '').trim();
        const eName = normalizeReqName(existing.staff_name || existing.staffName || '');
        if (eId && staffDateToRemove.has(`${eId}_${d}`)) return false;
        if (eName && nameDateToRemove.has(`${eName}_${d}`)) return false;
        return true;
      });
      scheduleSaveRequests(next);
      return next;
    });
  }, [scheduleSaveRequests]);

  const updateRequests = useCallback(async (update: any[] | ((prev: any[]) => any[])) => {
    const currentReqSnap = Array.isArray(requestsRef.current) ? requestsRef.current : [];
    let nextRaw = typeof update === 'function' ? update(currentReqSnap) : update;
    if (!Array.isArray(nextRaw)) nextRaw = [];

    // O(N) Map で既存レコードを引けるように最適化（O(N^2) 解消）
    const oldById = new Map<string, any>();
    for (let i = 0; i < currentReqSnap.length; i++) {
      const o = currentReqSnap[i];
      if (o && o.id) oldById.set(String(o.id), o);
    }

    const now = new Date().toISOString();
    const deviceSource = isMobileDevice() ? 'mobile' : 'web';
    const nextWithMeta = nextRaw.map(r => {
      if (!r) return r;
      const old = r.id ? oldById.get(String(r.id)) : undefined;
      let isChanged = !old;
      if (old && old !== r) {
        isChanged =
          old.type !== r.type ||
          old.status !== r.status ||
          old.date !== r.date ||
          old.hours !== r.hours ||
          old.reason !== r.reason ||
          old.staffName !== r.staffName ||
          old.updatedAt !== r.updatedAt ||
          old.details !== r.details;
      }

      if (isChanged) {
        return {
          ...r,
          updatedAt: now,
          details: { ...(r.details || {}), updatedAt: now },
          source: deviceSource
        };
      }
      return r;
    });

    const { cleanList, discardedIds } = deduplicateRequests(nextWithMeta);

    const toUpsert = cleanList.filter(nr => {
      if (!nr) return false;
      const old = nr.id ? oldById.get(String(nr.id)) : undefined;
      return !old || old.updatedAt !== nr.updatedAt;
    });

    // 1. 楽観的UI更新: 即座にメモリ上のステートを反映
    markLocalMutation(5000);
    setRequests(cleanList);
    scheduleSaveRequests(cleanList);

    // 2. バックグラウンド同期（失敗時のみロールバック）
    setIsSyncing(true);
    try {
      if (toUpsert.length > 0) {
        await cloudStorage.upsertRequestsAndShifts(toUpsert);
      }
      if (discardedIds.length > 0) {
        await cloudStorage.deleteRequests(discardedIds);
      }
      return cleanList;
    } catch (e: any) {
      console.error('Critical Update Error (Persistence Failed - Rolling back):', e);
      setRequests(currentReqSnap);
      scheduleSaveRequests(currentReqSnap);
      throw e;
    } finally {
      setIsSyncing(false);
    }
  }, [scheduleSaveRequests]);

  // クラウドからのデータを安全にマージする
  const mergeCloudRequests = useCallback(async (cloudReqs: any[]) => {
    setRequests(current => {
      const safeCurrent = Array.isArray(current) ? current : [];
      const safeCloud = Array.isArray(cloudReqs) ? cloudReqs : [];

      const cloudMonths = new Set(safeCloud.map(r => (r.date || '').substring(0, 7)).filter(m => m !== ''));

      const filteredCurrent = safeCurrent.filter(lr => {
        const dateStr = String(lr.date || '');
        if (dateStr.startsWith('2026-07')) return false;

        const idStr = String(lr.id || '');
        const isAuto = lr.is_manual === false || lr.isManual === false || lr.details?.isAuto === true || idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-') || idStr.startsWith('aw_');
        const month = (lr.date || '').substring(0, 7);

        if (isAuto && cloudMonths.has(month)) return false;
        return true;
      });

      const combined = [...filteredCurrent, ...safeCloud];
      const { cleanList } = deduplicateRequests(combined);
      scheduleSaveRequests(cleanList);
      return cleanList;
    });
  }, [scheduleSaveRequests]);

  const fetchRequests = useCallback(async (options?: FetchRequestsOptions) => {
    const force = options?.force ?? false;
    const baseYear = options?.baseYear ?? new Date().getFullYear();
    const merge = options?.merge ?? false;

    const now = Date.now();
    const loaded = loadedYearRangeRef.current;
    if (
      !force &&
      loaded &&
      baseYear >= loaded.minYear &&
      baseYear <= loaded.maxYear &&
      now - lastFetchedAtRef.current < 30000
    ) {
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const range = getFetchDateRange(baseYear);
      const data = await cloudStorage.fetchRequests({ baseYear });
      if (data) {
        if (merge) {
          const merged = [...requestsRef.current, ...data];
          await processAndSetRequests(merged, true);
          loadedYearRangeRef.current = loaded
            ? {
                minYear: Math.min(loaded.minYear, range.minYear),
                maxYear: Math.max(loaded.maxYear, range.maxYear),
              }
            : { minYear: range.minYear, maxYear: range.maxYear };
        } else {
          await processAndSetRequests(data, true);
          loadedYearRangeRef.current = { minYear: range.minYear, maxYear: range.maxYear };
        }
        lastFetchedAtRef.current = Date.now();
      }
    } catch (e) {
      console.error('Fetch requests error:', e);
    } finally {
      isFetchingRef.current = false;
    }
  }, [processAndSetRequests]);

  const ensureRequestsForYear = useCallback(async (targetYear: number) => {
    const loaded = loadedYearRangeRef.current;
    if (loaded && targetYear >= loaded.minYear && targetYear <= loaded.maxYear) {
      return;
    }
    await fetchRequests({ baseYear: targetYear, force: true, merge: !!loaded });
  }, [fetchRequests]);

  const markRequestsLoadedRange = useCallback((baseYear: number = new Date().getFullYear()) => {
    const range = getFetchDateRange(baseYear);
    loadedYearRangeRef.current = { minYear: range.minYear, maxYear: range.maxYear };
    lastFetchedAtRef.current = Date.now();
  }, []);

  const resetRequestCache = useCallback(() => {
    loadedYearRangeRef.current = null;
    lastFetchedAtRef.current = 0;
  }, []);

  return useMemo(() => ({
    requests,
    setRequests,
    requestsHistory,
    setRequestsHistory,
    updateRequests,
    processAndSetRequests,
    mergeCloudRequests,
    fetchRequests,
    ensureRequestsForYear,
    upsertLocalRequests,
    removeLocalRequests,
    markRequestsLoadedRange,
    resetRequestCache,
  }), [
    requests,
    requestsHistory,
    updateRequests,
    processAndSetRequests,
    mergeCloudRequests,
    fetchRequests,
    ensureRequestsForYear,
    upsertLocalRequests,
    removeLocalRequests,
    markRequestsLoadedRange,
    resetRequestCache,
  ]);
};
