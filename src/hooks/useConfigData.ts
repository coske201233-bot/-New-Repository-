import { useState, useEffect, useCallback, useMemo } from 'react';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage } from '../utils/cloudStorage';
import { isSupabaseAuthReady } from '../utils/supabase';

export const useConfigData = () => {
  const [weekdayLimit, setWeekdayLimit] = useState(12); // 平日デフォルト: 12人
  const [saturdayLimit, setSaturdayLimit] = useState(1); // 土曜デフォルト: 1人
  const [sundayLimit, setSundayLimit] = useState(0);    // 日曜デフォルト: 0人
  const [publicHolidayLimit, setPublicHolidayLimit] = useState(1); // 祝日デフォルト: 1人
  const [monthlyLimits, setMonthlyLimits] = useState<Record<string, any>>({});
  const [adminPassword, setAdminPassword] = useState('0000');
  const [staffViewMode, setStaffViewMode] = useState(false);

  // カスタム属性のリスト
  const [professions, setProfessions] = useState<string[]>(['PT', 'OT', 'ST', '助手']);
  const [roles, setRoles] = useState<string[]>(['科長', '係長', '主査', '主任', '主事', '会計年度']);
  const [placements, setPlacements] = useState<string[]>(['外来', '２F', '包括', '４F', '排尿', '兼務', 'フォロー', '管理', '事務', '訪問リハ']);
  const [statuses, setStatuses] = useState<string[]>(['常勤', '非常勤', '育休', '休職']);

  // 統合されたconfigオブジェクト（読み取り用）
  const config = useMemo(() => ({
    '@weekday_limit': weekdayLimit,
    '@saturday_limit': saturdayLimit,
    '@sunday_limit': sundayLimit,
    '@public_holiday_limit': publicHolidayLimit,
    '@monthly_limits': monthlyLimits,
    '@admin_password': adminPassword,
    '@staff_view_mode': staffViewMode,
    '@professions': professions,
    '@roles': roles,
    '@placements': placements,
    '@statuses': statuses
  }), [weekdayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, adminPassword, staffViewMode, professions, roles, placements, statuses]);

  const refreshConfigs = useCallback(async () => {
    if (!isSupabaseAuthReady) {
      console.log('⚠️ [LOCAL_CONFIG] Supabase disabled. Using local config only.');
      return;
    }
    try {
      const cloudConfigs = await cloudStorage.fetchConfigs();
      if (!cloudConfigs) return;

      const safeNumber = (v: any, fallback: number) => {
        const n = Number(v);
        return isNaN(n) ? fallback : n;
      };

      const safeList = (v: any, fallback: string[]) => {
        return Array.isArray(v) ? v : fallback;
      };

      if (cloudConfigs[STORAGE_KEYS.WEEKDAY_LIMIT] !== undefined) setWeekdayLimit(safeNumber(cloudConfigs[STORAGE_KEYS.WEEKDAY_LIMIT], 12));
      if (cloudConfigs[STORAGE_KEYS.SATURDAY_LIMIT] !== undefined) setSaturdayLimit(safeNumber(cloudConfigs[STORAGE_KEYS.SATURDAY_LIMIT], 1));
      if (cloudConfigs[STORAGE_KEYS.SUNDAY_LIMIT] !== undefined) setSundayLimit(safeNumber(cloudConfigs[STORAGE_KEYS.SUNDAY_LIMIT], 0));
      if (cloudConfigs[STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT] !== undefined) setPublicHolidayLimit(safeNumber(cloudConfigs[STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT], 1));
      if (cloudConfigs[STORAGE_KEYS.MONTHLY_LIMITS] !== undefined) setMonthlyLimits(cloudConfigs[STORAGE_KEYS.MONTHLY_LIMITS]);
      if (cloudConfigs[STORAGE_KEYS.ADMIN_PASSWORD] !== undefined) setAdminPassword(String(cloudConfigs[STORAGE_KEYS.ADMIN_PASSWORD]));
      if (cloudConfigs[STORAGE_KEYS.STAFF_VIEW_MODE] !== undefined) setStaffViewMode(Boolean(cloudConfigs[STORAGE_KEYS.STAFF_VIEW_MODE]));
      
      if (cloudConfigs[STORAGE_KEYS.PROFESSIONS] !== undefined) setProfessions(safeList(cloudConfigs[STORAGE_KEYS.PROFESSIONS], professions));
      if (cloudConfigs[STORAGE_KEYS.ROLES] !== undefined) setRoles(safeList(cloudConfigs[STORAGE_KEYS.ROLES], roles));
      if (cloudConfigs[STORAGE_KEYS.PLACEMENTS] !== undefined) setPlacements(safeList(cloudConfigs[STORAGE_KEYS.PLACEMENTS], placements));
      if (cloudConfigs[STORAGE_KEYS.STATUSES] !== undefined) setStatuses(safeList(cloudConfigs[STORAGE_KEYS.STATUSES], statuses));

      console.log('✅ Configs refreshed from cloud');
    } catch (e) {
      console.warn('Config refresh failed:', e);
    }
  }, [professions, roles, placements, statuses]);

  useEffect(() => {
    refreshConfigs();
  }, [refreshConfigs]);

  const updateConfigValue = useCallback(async (key: string, val: any) => {
    try {
      // 内部ステートの即時反映
      if (key === STORAGE_KEYS.WEEKDAY_LIMIT) setWeekdayLimit(Number(val) || 0);
      if (key === STORAGE_KEYS.SATURDAY_LIMIT) setSaturdayLimit(Number(val) || 0);
      if (key === STORAGE_KEYS.SUNDAY_LIMIT) setSundayLimit(Number(val) || 0);
      if (key === STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT) setPublicHolidayLimit(Number(val) || 0);
      if (key === STORAGE_KEYS.MONTHLY_LIMITS) setMonthlyLimits(val);
      if (key === STORAGE_KEYS.ADMIN_PASSWORD) setAdminPassword(String(val));
      if (key === STORAGE_KEYS.STAFF_VIEW_MODE) setStaffViewMode(Boolean(val));
      
      if (key === STORAGE_KEYS.PROFESSIONS) setProfessions(val);
      if (key === STORAGE_KEYS.ROLES) setRoles(val);
      if (key === STORAGE_KEYS.PLACEMENTS) setPlacements(val);
      if (key === STORAGE_KEYS.STATUSES) setStatuses(val);

      // 保存処理
      await saveData(key, val);
      if (isSupabaseAuthReady) {
        await cloudStorage.upsertConfig(key, val);
      }
    } catch (e) {
      console.error('Config update error:', e);
      throw e;
    }
  }, []);

  const updateLimits = useCallback(async (type: string, val: number, monthStr?: string) => {
    if (monthStr) {
        const base = { weekday: 12, sat: 1, sun: 0, pub: 1, ...(monthlyLimits[monthStr] || {}) };
        const next = { ...monthlyLimits, [monthStr]: { ...base, [type]: val } };
        await updateConfigValue(STORAGE_KEYS.MONTHLY_LIMITS, next);
    } else {
        const key = type === 'weekday' ? STORAGE_KEYS.WEEKDAY_LIMIT :
                    type === 'saturday' ? STORAGE_KEYS.SATURDAY_LIMIT :
                    type === 'sunday' ? STORAGE_KEYS.SUNDAY_LIMIT :
                    type === 'publicHoliday' ? STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT : '';
        if (key) await updateConfigValue(key, val);
    }
  }, [monthlyLimits, updateConfigValue]);

  return useMemo(() => ({ 
    config, 
    weekdayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, adminPassword, staffViewMode, 
    professions, roles, placements, statuses,
    updateLimits, updatePassword: (p: string) => updateConfigValue(STORAGE_KEYS.ADMIN_PASSWORD, p),
    updateConfigValue,
    refreshConfigs
  }), [config, weekdayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, adminPassword, staffViewMode, professions, roles, placements, statuses, updateLimits, updateConfigValue, refreshConfigs]);
};
