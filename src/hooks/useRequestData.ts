import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
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

interface LocalMutationOverride {
  status: string;
  updatedAt: string;
  expiresAt: number;
  inFlight: boolean;
}

const isPendingStatus = (status: any): boolean => {
  const s = String(status || '').trim().toLowerCase();
  return !s || s === 'pending' || s === '申請中';
};

export const useRequestData = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [requestsHistory, setRequestsHistory] = useState<any[][]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const requestsRef = useRef<any[]>(requests);
  requestsRef.current = requests;

  const isFetchingRef = useRef(false);
  const lastFetchedAtRef = useRef<number>(0);
  const loadedYearRangeRef = useRef<{ minYear: number; maxYear: number } | null>(null);
  const hasCloudOrMutationRef = useRef<boolean>(false);
  const saveTimerRef = useRef<any>(null);

  // ローカルで楽観的に確定操作（承認/却下/削除等）を行ったレコードの一時保護マップ
  // バックグラウンドDB保存中〜反映直後に走った fetchRequests() が古い pending で巻き戻すのを完全防止
  const recentMutationOverridesRef = useRef<Map<string, LocalMutationOverride>>(new Map());
  // 進行中のDB保存Promise群（手動リフレッシュ時はこれらの完了を待ってから最新をフェッチする）
  const pendingDbPromisesRef = useRef<Set<Promise<any>>>(new Set());

  const persistWebLocalStorage = useCallback((list: any[]) => {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('proto_request_data', JSON.stringify(list));
      } catch (e) {
        console.warn('localStorage proto_request_data write warning:', e);
      }
    }
  }, []);

  // 非同期・デバウンスで永続化（通常更新用）
  const scheduleSaveRequests = useCallback((list: any[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveData(STORAGE_KEYS.REQUESTS, list).catch(() => {});
      persistWebLocalStorage(list);
    }, 300);
  }, [persistWebLocalStorage]);

  // 承認・却下・削除直後に即時永続化（リロードしても古い pending キャッシュが復活しないよう即座に上書き）
  const persistRequestsImmediately = useCallback((list: any[]) => {
    hasCloudOrMutationRef.current = true;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    persistWebLocalStorage(list);
    saveData(STORAGE_KEYS.REQUESTS, list).catch(() => {});
  }, [persistWebLocalStorage]);

  // ローカル確定操作の登録・完了通知・解除
  const registerLocalRequestMutation = useCallback((id: string, status: string, updatedAt: string = new Date().toISOString()) => {
    const cleanId = String(id || '').replace(/['"]/g, '').trim();
    if (!cleanId) return;
    hasCloudOrMutationRef.current = true;
    recentMutationOverridesRef.current.set(cleanId, {
      status,
      updatedAt,
      expiresAt: Date.now() + 20000, // 20秒間保護
      inFlight: true,
    });
  }, []);

  const markLocalRequestMutationCommitted = useCallback((id: string) => {
    const cleanId = String(id || '').replace(/['"]/g, '').trim();
    if (!cleanId) return;
    const entry = recentMutationOverridesRef.current.get(cleanId);
    if (entry) {
      entry.inFlight = false;
      entry.expiresAt = Date.now() + 10000; // DBコミット完了後も10秒間は古いリフェッチ結果から保護
    }
  }, []);

  const clearLocalRequestMutation = useCallback((id: string) => {
    const cleanId = String(id || '').replace(/['"]/g, '').trim();
    if (!cleanId) return;
    recentMutationOverridesRef.current.delete(cleanId);
  }, []);

  const trackDbMutationPromise = useCallback(<T,>(promise: Promise<T>): Promise<T> => {
    pendingDbPromisesRef.current.add(promise);
    const cleanup = () => {
      pendingDbPromisesRef.current.delete(promise);
    };
    promise.then(cleanup, cleanup);
    return promise;
  }, []);

  // クラウド取得結果に対して、進行中・直近のローカル確定操作（approved/rejected/deleted）が古い pending で巻き戻されないよう適用
  const applyRecentMutationOverrides = useCallback((cloudList: any[]): any[] => {
    const overrides = recentMutationOverridesRef.current;
    if (overrides.size === 0) return cloudList;

    const nowMs = Date.now();
    // 期限切れエントリの掃除
    for (const [key, val] of overrides.entries()) {
      if (!val.inFlight && val.expiresAt <= nowMs) {
        overrides.delete(key);
      }
    }
    if (overrides.size === 0) return cloudList;

    const result: any[] = [];
    for (let i = 0; i < cloudList.length; i++) {
      const r = cloudList[i];
      if (!r) continue;
      const cleanId = String(r.id || '').replace(/['"]/g, '').trim();
      const ov = cleanId ? overrides.get(cleanId) : undefined;
      if (!ov) {
        result.push(r);
        continue;
      }

      // 削除済みとして楽観更新中ならリストから除外
      if (ov.status === 'deleted' || ov.status === '削除') {
        continue;
      }

      // DB側がすでに目標ステータスになっていればそのまま採用してオーバーライド解除可能
      if (r.status === ov.status) {
        if (!ov.inFlight) overrides.delete(cleanId);
        result.push(r);
        continue;
      }

      // 進行中または直近の確定操作に対してDB側から古い pending が返ってきた場合はローカルの最新ステータスを保持
      if (ov.inFlight || (isPendingStatus(r.status) && !isPendingStatus(ov.status))) {
        result.push({
          ...r,
          status: ov.status,
          updatedAt: ov.updatedAt,
          details: { ...(r.details || {}), updatedAt: ov.updatedAt },
        });
      } else {
        result.push(r);
      }
    }
    return result;
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const lr = await loadData(STORAGE_KEYS.REQUESTS);
      // 既にクラウド同期またはローカル更新が完了している場合は、遅れて解決した古いキャッシュで絶対に上書きしない
      if (mounted && lr && !hasCloudOrMutationRef.current) {
        const { cleanList } = deduplicateRequests(lr);
        setRequests(cleanList);
      }
    };
    load();
    return () => {
      mounted = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // マージと重複排除を行う共通処理（常にDB最新ステータス＆直近ローカル確定操作を保護）
  const processAndSetRequests = useCallback(async (nextFullList: any[], isFromCloud = false) => {
    if (isFromCloud) {
      hasCloudOrMutationRef.current = true;
    }
    const protectedList = isFromCloud ? applyRecentMutationOverrides(nextFullList) : nextFullList;
    const { cleanList, discardedIds } = deduplicateRequests(protectedList);

    // 状態を更新し、ローカルキャッシュにも最新状態を反映
    setRequests(cleanList);
    if (isFromCloud) {
      persistRequestsImmediately(cleanList);
    } else {
      scheduleSaveRequests(cleanList);
    }

    return { cleanList, discardedIds };
  }, [applyRecentMutationOverrides, persistRequestsImmediately, scheduleSaveRequests]);

  // 楽観的UI更新用: 変更・追加されたレコードのみをステートに即時マージ（O(N)）
  const upsertLocalRequests = useCallback((items: any[]) => {
    if (!Array.isArray(items) || items.length === 0) return;
    hasCloudOrMutationRef.current = true;

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
    hasCloudOrMutationRef.current = true;

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
    hasCloudOrMutationRef.current = true;
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

  // クラウドからのデータを安全にマージする（DB最新ステータスを常に優先）
  const mergeCloudRequests = useCallback(async (cloudReqs: any[]) => {
    hasCloudOrMutationRef.current = true;
    const safeCloud = applyRecentMutationOverrides(Array.isArray(cloudReqs) ? cloudReqs : []);
    setRequests(current => {
      const safeCurrent = Array.isArray(current) ? current : [];
      const cloudById = new Map<string, any>();
      safeCloud.forEach(r => {
        if (r && r.id) cloudById.set(String(r.id).replace(/['"]/g, '').trim(), r);
      });

      const cloudMonths = new Set(safeCloud.map(r => (r.date || '').substring(0, 7)).filter(m => m !== ''));

      const filteredCurrent = safeCurrent.filter(lr => {
        if (!lr) return false;
        const cleanId = String(lr.id || '').replace(/['"]/g, '').trim();
        // クラウドに同一IDが存在する場合は、常にDBの最新レコードを採用するため古いローカル版を除外
        if (cleanId && cloudById.has(cleanId)) return false;

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
      persistRequestsImmediately(cleanList);
      return cleanList;
    });
  }, [applyRecentMutationOverrides, persistRequestsImmediately]);

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
      // 承認・却下・削除などのバックグラウンドDB更新が進行中であれば、完了を待ってから最新DBを取得する
      if (pendingDbPromisesRef.current.size > 0) {
        await Promise.allSettled(Array.from(pendingDbPromisesRef.current));
      }

      const range = getFetchDateRange(baseYear);
      const data = await cloudStorage.fetchRequests({ baseYear });
      if (data) {
        if (merge) {
          // マージ時はDB最新レコードを優先し、ローカル側の同一ID・同期間の古い pending を上書きする
          const cloudIds = new Set(data.map((r: any) => String(r?.id || '').replace(/['"]/g, '').trim()).filter(Boolean));
          const keptLocal = requestsRef.current.filter(lr => {
            if (!lr) return false;
            const lid = String(lr.id || '').replace(/['"]/g, '').trim();
            if (lid && cloudIds.has(lid)) return false;
            const d = normalizeDateStr(lr.date);
            // 今回取得した日付範囲内のレコードはクラウド側を真実のソース（Source of Truth）とする
            if (d && d >= range.startDate && d <= range.endDate) return false;
            return true;
          });
          await processAndSetRequests([...keptLocal, ...data], true);
          loadedYearRangeRef.current = loaded
            ? {
                minYear: Math.min(loaded.minYear, range.minYear),
                maxYear: Math.max(loaded.maxYear, range.maxYear),
              }
            : { minYear: range.minYear, maxYear: range.maxYear };
        } else {
          // 非マージ取得時はDBから返った最新一覧をそのまま Source of Truth として反映
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
    hasCloudOrMutationRef.current = true;
    const range = getFetchDateRange(baseYear);
    loadedYearRangeRef.current = { minYear: range.minYear, maxYear: range.maxYear };
    lastFetchedAtRef.current = Date.now();
  }, []);

  const resetRequestCache = useCallback(() => {
    loadedYearRangeRef.current = null;
    lastFetchedAtRef.current = 0;
    hasCloudOrMutationRef.current = false;
    recentMutationOverridesRef.current.clear();
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
    persistRequestsImmediately,
    registerLocalRequestMutation,
    markLocalRequestMutationCommitted,
    clearLocalRequestMutation,
    trackDbMutationPromise,
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
    persistRequestsImmediately,
    registerLocalRequestMutation,
    markLocalRequestMutationCommitted,
    clearLocalRequestMutation,
    trackDbMutationPromise,
  ]);
};
