import { getDayType } from './dateUtils';

/**
 * 指定された日付の出勤制限人数を取得します。
 */
export const getCurrentLimit = (
  date: Date,
  weekdayLimit: number,
  saturdayLimit: number,
  sundayLimit: number,
  publicHolidayLimit: number,
  monthlyLimits: Record<string, { weekday: number, sat: number, sun: number, pub: number }>
) => {
  const dayType = getDayType(date);
  const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthly = monthlyLimits[monthStr] || { 
    weekday: weekdayLimit, 
    sat: saturdayLimit, 
    sun: sundayLimit, 
    pub: publicHolidayLimit 
  };

  const raw = dayType === 'weekday' ? currentMonthly.weekday : 
               dayType === 'sat' ? currentMonthly.sat :
               dayType === 'sun' ? currentMonthly.sun :
               currentMonthly.pub;
  
  return Number(raw) || (dayType === 'weekday' ? 12 : 1);
};
