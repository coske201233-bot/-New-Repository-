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
      const loadConfig = async (key: string, setter: (v: any) => void) => {
        try {
          const lv = await loadData(key);
          if (lv !== null) setter(lv);
          const cv = await cloudStorage.fetchConfig(key);
          if (cv !== undefined && cv !== null) setter(cv);
        } catch (e) {
          console.warn(`Config load failed for key: ${key}`, e);
        }
      };
      await loadConfig(STORAGE_KEYS.WEEKDAY_LIMIT, setWeekdayLimit);
      await loadConfig(STORAGE_KEYS.SATURDAY_LIMIT, setSaturdayLimit);
      await loadConfig(STORAGE_KEYS.SUNDAY_LIMIT, setSundayLimit);
      await loadConfig(STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT, setPublicHolidayLimit);
      await loadConfig(STORAGE_KEYS.MONTHLY_LIMITS, setMonthlyLimits);
      await loadConfig(STORAGE_KEYS.ADMIN_PASSWORD, setAdminPassword);
      await loadConfig(STORAGE_KEYS.STAFF_VIEW_MODE, setStaffViewMode);
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
