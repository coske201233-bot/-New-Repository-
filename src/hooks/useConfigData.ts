import { useState, useEffect } from 'react';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage } from '../utils/cloudStorage';

export const useConfigData = () => {
  const [weekdayLimit, setWeekdayLimit] = useState(12);
  const [holidayLimit, setHolidayLimit] = useState(2);
  const [saturdayLimit, setSaturdayLimit] = useState(2);
  const [sundayLimit, setSundayLimit] = useState(2);
  const [publicHolidayLimit, setPublicHolidayLimit] = useState(2);
  const [monthlyLimits, setMonthlyLimits] = useState<Record<string, any>>({});
  const [adminPassword, setAdminPassword] = useState('1114');
  const [staffViewMode, setStaffViewMode] = useState(false);

  useEffect(() => {
    const load = async () => {
      const loadConfig = async (key: string, setter: (v: any) => void) => {
        const lv = await loadData(key);
        if (lv !== null) setter(lv);
        const cv = await cloudStorage.fetchConfig(key);
        if (cv !== undefined && cv !== null) setter(cv);
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

  return { weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, adminPassword, staffViewMode, setStaffViewMode, setMonthlyLimits, setAdminPassword };
};
