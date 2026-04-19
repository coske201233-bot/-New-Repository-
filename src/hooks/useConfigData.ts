import { useState, useEffect, useCallback, useMemo } from 'react';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage } from '../utils/cloudStorage';

export const useConfigData = () => {
  const [weekdayLimit, setWeekdayLimit] = useState(12);
  const [holidayLimit, setHolidayLimit] = useState(2);
  const [saturdayLimit, setSaturdayLimit] = useState(2);
  const [sundayLimit, setSundayLimit] = useState(2);
  const [publicHolidayLimit, setPublicHolidayLimit] = useState(2);
  const [monthlyLimits, setMonthlyLimits] = useState<Record<string, any>>({});
  const [adminPassword, setAdminPassword] = useState('0000');
  const [staffViewMode, setStaffViewMode] = useState(false);

  // 統合されたconfigオブジェクト（読み取り用）
  const config = useMemo(() => ({
    '@weekday_limit': weekdayLimit,
    '@saturday_limit': saturdayLimit,
    '@sunday_limit': sundayLimit,
    '@public_holiday_limit': publicHolidayLimit,
    '@monthly_limits': monthlyLimits,
    '@admin_password': adminPassword,
    '@staff_view_mode': staffViewMode
  }), [weekdayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, adminPassword, staffViewMode]);

  useEffect(() => {
    const load = async () => {
      const configKeys = [
        { key: STORAGE_KEYS.WEEKDAY_LIMIT, setter: setWeekdayLimit },
        { key: STORAGE_KEYS.SATURDAY_LIMIT, setter: setSaturdayLimit },
        { key: STORAGE_KEYS.SUNDAY_LIMIT, setter: setSundayLimit },
        { key: STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT, setter: setPublicHolidayLimit },
        { key: STORAGE_KEYS.MONTHLY_LIMITS, setter: setMonthlyLimits },
        { key: STORAGE_KEYS.ADMIN_PASSWORD, setter: setAdminPassword },
        { key: STORAGE_KEYS.STAFF_VIEW_MODE, setter: setStaffViewMode },
      ];

      const loadItem = async (key: string, setter: (v: any) => void) => {
        try {
          const lv = await loadData(key);
          if (lv !== null) setter(lv);
          
          const cv = await Promise.race([
            cloudStorage.fetchConfig(key),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
          ]).catch(() => null);

          if (cv !== undefined && cv !== null) setter(cv);
        } catch (e) {
          console.warn(`Config background load failed for key: ${key}`);
        }
      };

      configKeys.forEach(item => loadItem(item.key, item.setter));
    };
    load();
  }, []);

  const updateConfigValue = useCallback(async (key: string, val: any) => {
    try {
      // 内部ステートの即時反映
      if (key === STORAGE_KEYS.WEEKDAY_LIMIT) setWeekdayLimit(Number(val));
      if (key === STORAGE_KEYS.SATURDAY_LIMIT) setSaturdayLimit(Number(val));
      if (key === STORAGE_KEYS.SUNDAY_LIMIT) setSundayLimit(Number(val));
      if (key === STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT) setPublicHolidayLimit(Number(val));
      if (key === STORAGE_KEYS.MONTHLY_LIMITS) setMonthlyLimits(val);
      if (key === STORAGE_KEYS.ADMIN_PASSWORD) setAdminPassword(String(val));
      if (key === STORAGE_KEYS.STAFF_VIEW_MODE) setStaffViewMode(Boolean(val));

      // 保存処理
      await saveData(key, val);
      await cloudStorage.saveConfig(key, val);
    } catch (e) {
      console.error('Config update error:', e);
      throw e;
    }
  }, []);

  const updateLimits = useCallback(async (type: string, val: number, monthStr?: string) => {
    if (monthStr) {
        const next = { ...monthlyLimits, [monthStr]: { ...(monthlyLimits[monthStr] || { weekday: 12, sat: 1, sun: 0, pub: 1 }), [type]: val } };
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
    weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, adminPassword, staffViewMode, 
    updateLimits, updatePassword: (p: string) => updateConfigValue(STORAGE_KEYS.ADMIN_PASSWORD, p),
    updateConfigValue
  }), [config, weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, adminPassword, staffViewMode, updateLimits, updateConfigValue]);
};
