import { useState, useCallback, useMemo, useRef } from 'react';
import { cloudStorage, getFetchDateRange } from '../utils/cloudStorage';
import { normalizeDateStr } from '../utils/dateUtils';

const normalizeShiftName = (name: string) =>
  (name || '').replace(/[\s　]/g, '').replace(/公費/g, '').toUpperCase();

const extractUuid = (idStr: string): string | null => {
  if (!idStr) return null;
  const parts = String(idStr).split('-');
  return parts.length >= 6 ? parts.slice(1, 6).join('-') : null;
};

const isManualShiftEntry = (rec: any): boolean => {
  if (!rec) return false;
  if (rec.is_manual === true || rec.isManual === true || rec.details?.isManual === true) return true;
  if (rec.is_manual === false || rec.isManual === false || rec.details?.isManual === false || rec.details?.isAuto === true) return false;
  return String(rec.id || '').startsWith('m-') || String(rec.id || '').startsWith('req-');
};

const OFF_TYPES = new Set([
  '公休', '年休', '有給休暇', '夏季休暇', '特休', '休暇', '欠勤', '研修', '出張',
  '振替＋時間休', '振替4', '振替3.75', '振3.75', '全休', '年給', '有給', '午前休', '午後休'
]);

const deduplicateShifts = (data: any[]): any[] => {
  // 1. 正規化（日勤 -> 出勤）
  const priorityMap = new Map<string, any>();

  for (let i = 0; i < data.length; i++) {
    const raw = data[i];
    if (!raw || !raw.date) continue;
    const s = raw.type === '日勤' ? { ...raw, type: '出勤' } : raw;

    const extractedId = extractUuid(s.id);
    const sId = String(s.staff_id || s.staffId || s.user_id || s.userId || extractedId || '').trim();
    const sName = normalizeShiftName(s.staff_name || s.staffName || '');
    if (!sId && !sName) continue;

    const dateStr = normalizeDateStr(s.date);
    if (!dateStr) continue;
    const key = sId ? `${sId}_${dateStr}` : `name_${sName}_${dateStr}`;

    const existing = priorityMap.get(key);
    if (!existing) {
      priorityMap.set(key, s);
      continue;
    }

    const existingIsManual = isManualShiftEntry(existing);
    const newIsManual = isManualShiftEntry(s);

    if (newIsManual && !existingIsManual) {
      priorityMap.set(key, s);
      continue;
    }
    if (!newIsManual && existingIsManual) continue;

    if (OFF_TYPES.has(s.type) && !OFF_TYPES.has(existing.type)) {
      priorityMap.set(key, s);
    }
  }

  return Array.from(priorityMap.values());
};

export interface ShiftRemovalCriteria {
  id?: string;
  staffId?: string;
  staffName?: string;
  date?: string;
}

export interface FetchShiftsOptions {
  baseYear?: number;
  force?: boolean;
  merge?: boolean;
}

export const useShiftData = () => {
  const [shifts, setShifts] = useState<any[]>([]);
  const [isLoadingShifts, setIsLoadingShifts] = useState(false);
  const isFetchingRef = useRef(false);
  const lastFetchedAtRef = useRef<number>(0);
  const loadedYearRangeRef = useRef<{ minYear: number; maxYear: number } | null>(null);

  const fetchShifts = useCallback(async (options?: FetchShiftsOptions) => {
    const force = options?.force ?? false;
    const baseYear = options?.baseYear ?? new Date().getFullYear();
    const merge = options?.merge ?? false;

    // クールダウン制御: 強制再取得でない限り、直近30秒以内に同一範囲を取得済みならスキップ
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
    setIsLoadingShifts(true);
    try {
      const range = getFetchDateRange(baseYear);
      const data = await cloudStorage.fetchShifts({ baseYear });

      if (data) {
        if (merge) {
          setShifts(prev => deduplicateShifts([...prev, ...data]));
          loadedYearRangeRef.current = loaded
            ? {
                minYear: Math.min(loaded.minYear, range.minYear),
                maxYear: Math.max(loaded.maxYear, range.maxYear),
              }
            : { minYear: range.minYear, maxYear: range.maxYear };
        } else {
          const deduplicated = deduplicateShifts(data);
          setShifts(deduplicated);
          loadedYearRangeRef.current = { minYear: range.minYear, maxYear: range.maxYear };
        }
        lastFetchedAtRef.current = Date.now();
      }
    } catch (e) {
      console.error('[ShiftEngine] Global fetch error:', e);
    } finally {
      isFetchingRef.current = false;
      setIsLoadingShifts(false);
    }
  }, []);

  // 表示対象年が取得済み範囲外のときのみ追加取得してマージ
  const ensureShiftsForYear = useCallback(async (targetYear: number) => {
    const loaded = loadedYearRangeRef.current;
    if (loaded && targetYear >= loaded.minYear && targetYear <= loaded.maxYear) {
      return;
    }
    await fetchShifts({ baseYear: targetYear, force: true, merge: !!loaded });
  }, [fetchShifts]);

  // 楽観的UI更新用: 変更・追加されたシフトレコードのみをステートに即時マージ（フルリフェッチ不要）
  const upsertLocalShifts = useCallback((items: any[]) => {
    if (!Array.isArray(items) || items.length === 0) return;

    const normalizedItems = items
      .filter(Boolean)
      .map(s => ({
        ...s,
        date: normalizeDateStr(s.date),
        type: s.type === '日勤' ? '出勤' : s.type,
      }));

    if (normalizedItems.length === 0) return;

    // 置換対象キー（id / staffId+date / staffName+date）を構築
    const replaceIds = new Set<string>();
    const replaceStaffDate = new Set<string>();
    const replaceNameDate = new Set<string>();

    for (const s of normalizedItems) {
      if (s.id) replaceIds.add(String(s.id));
      const d = s.date;
      if (!d) continue;
      const sId = String(s.staff_id || s.staffId || s.user_id || s.userId || '').trim();
      const sName = normalizeShiftName(s.staff_name || s.staffName || '');
      if (sId) replaceStaffDate.add(`${sId}_${d}`);
      if (sName) replaceNameDate.add(`${sName}_${d}`);
    }

    setShifts(prev => {
      const filtered = prev.filter(existing => {
        if (!existing) return false;
        if (existing.id && replaceIds.has(String(existing.id))) return false;
        const d = normalizeDateStr(existing.date);
        if (!d) return true;
        const eId = String(existing.staff_id || existing.staffId || existing.user_id || existing.userId || extractUuid(existing.id) || '').trim();
        const eName = normalizeShiftName(existing.staff_name || existing.staffName || '');
        if (eId && replaceStaffDate.has(`${eId}_${d}`)) return false;
        if (eName && replaceNameDate.has(`${eName}_${d}`)) return false;
        return true;
      });
      return [...filtered, ...normalizedItems];
    });
  }, []);

  // 楽観的UI更新用: 削除されたシフトレコードのみをステートから即時除外
  const removeLocalShifts = useCallback((criteriaList: ShiftRemovalCriteria[]) => {
    if (!Array.isArray(criteriaList) || criteriaList.length === 0) return;

    const idsToRemove = new Set<string>();
    const staffDateToRemove = new Set<string>();
    const nameDateToRemove = new Set<string>();

    for (const c of criteriaList) {
      if (!c) continue;
      if (c.id) idsToRemove.add(String(c.id).trim());
      const d = normalizeDateStr(c.date);
      if (!d) continue;
      if (c.staffId) staffDateToRemove.add(`${String(c.staffId).trim()}_${d}`);
      if (c.staffName) {
        const n = normalizeShiftName(c.staffName);
        if (n) nameDateToRemove.add(`${n}_${d}`);
      }
    }

    setShifts(prev =>
      prev.filter(existing => {
        if (!existing) return false;
        if (existing.id && idsToRemove.has(String(existing.id).trim())) return false;
        const d = normalizeDateStr(existing.date);
        if (!d) return true;
        const eId = String(existing.staff_id || existing.staffId || existing.user_id || existing.userId || extractUuid(existing.id) || '').trim();
        const eName = normalizeShiftName(existing.staff_name || existing.staffName || '');
        if (eId && staffDateToRemove.has(`${eId}_${d}`)) return false;
        if (eName && nameDateToRemove.has(`${eName}_${d}`)) return false;
        return true;
      })
    );
  }, []);

  const resetShiftCache = useCallback(() => {
    loadedYearRangeRef.current = null;
    lastFetchedAtRef.current = 0;
  }, []);

  return useMemo(() => ({
    shifts,
    setShifts,
    isLoadingShifts,
    fetchShifts,
    ensureShiftsForYear,
    upsertLocalShifts,
    removeLocalShifts,
    resetShiftCache,
  }), [shifts, isLoadingShifts, fetchShifts, ensureShiftsForYear, upsertLocalShifts, removeLocalShifts, resetShiftCache]);
};
