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

      // 個別のロード関数
      const loadItem = async (key: string, setter: (v: any) => void) => {
        try {
          const lv = await loadData(key);
          if (lv !== null) setter(lv);
          
          // クラウド取得。タイムアウトを設けて起動を妨げないようにする
          const cv = await Promise.race([
            cloudStorage.fetchConfig(key),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
          ]).catch(() => null);

          if (cv !== undefined && cv !== null) setter(cv);
        } catch (e) {
          console.warn(`Config background load failed for key: ${key}`);
        }
      };

      // すべての設定を並列でロード開始（全体を待たない）
      configKeys.forEach(item => loadItem(item.key, item.setter));
    };
    load();
  }, []);

  const updateLimits = useCallback(async (type: string, val: number, monthStr?: string) => {
    try {
      if (monthStr) {
        setMonthlyLimits(prev => {
          const next = { ...prev, [monthStr]: { ...(prev[monthStr] || { weekday: 12, sat: 1, sun: 0, pub: 1 }), [type]: val } };
          
          // 非同期処理をバックグラウンドで開始
          cloudStorage.saveConfig(STORAGE_KEYS.MONTHLY_LIMITS, next).catch(e => console.error('Save cloud config failed:', e));
          saveData(STORAGE_KEYS.MONTHLY_LIMITS, next).catch(e => console.error('Save local config failed:', e));
          
          return next;
        });
      } else {
        const key = type === 'weekday' ? STORAGE_KEYS.WEEKDAY_LIMIT :
                    type === 'saturday' ? STORAGE_KEYS.SATURDAY_LIMIT :
                    type === 'sunday' ? STORAGE_KEYS.SUNDAY_LIMIT :
                    type === 'publicHoliday' ? STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT : '';
        
        if (key) {
          await cloudStorage.saveConfig(key, val);
          if (type === 'weekday') setWeekdayLimit(val);
          if (type === 'saturday') setSaturdayLimit(val);
          if (type === 'sunday') setSundayLimit(val);
          if (type === 'publicHoliday') setPublicHolidayLimit(val);
          await saveData(key, val);
        }
      }
    } catch (e) {
      console.error('Config update error:', e);
      throw e;
    }
  }, []);

  const updatePassword = useCallback(async (pass: string) => {
    setAdminPassword(pass);
    await saveData(STORAGE_KEYS.ADMIN_PASSWORD, pass);
    await cloudStorage.saveConfig(STORAGE_KEYS.ADMIN_PASSWORD, pass);
  }, []);

  return useMemo(() => ({ 
    weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, adminPassword, staffViewMode, 
    setStaffViewMode, setMonthlyLimits, setAdminPassword,
    updateLimits, updatePassword
  }), [weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, adminPassword, staffViewMode, updateLimits, updatePassword]);
};
