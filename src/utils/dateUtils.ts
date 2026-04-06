/**
 * 2026年の日本の祝日データ
 */
const JAPAN_HOLIDAYS = [
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
  '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
  '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
  '2026-10-12', '2026-11-03', '2026-11-23',
  // --- 2027年 ---
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
  '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19',
  '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23'
];

/**
 * 指定された日付が祝日かどうかを判定します
 */
export const isHoliday = (date: Date): boolean => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  return JAPAN_HOLIDAYS.includes(dateStr);
};

/**
 * 指定された日付の曜日/祝日タイプを返します
 */
export const getDayType = (date: Date): 'weekday' | 'sat' | 'sun' | 'holiday' => {
  const day = date.getDay();
  if (day === 0) return 'sun';
  if (isHoliday(date)) return 'holiday';
  if (day === 6) return 'sat';
  return 'weekday';
};

/**
 * 指定された月の各日タイプごとの日数をカウントします
 */
export const getMonthDayCounts = (year: number, month: number) => {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const counts = {
    weekday: 0,
    sat: 0,
    sun: 0,
    holiday: 0,
  };

  for (let i = 1; i <= daysInMonth; i++) {
    const type = getDayType(new Date(year, month, i));
    counts[type]++;
  }

  return counts;
};
/**
 * 日付を「YYYY-MM-DD」形式の文字列（タイムゾーン不問）に変換します
 */
export const getDateStr = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * 日付を「2026年01月01日(木)」形式の文字列に変換します
 */
export const formatDate = (dateInput: string | Date): string => {
  const date = typeof dateInput === 'string' 
    ? (dateInput.includes('-') && !dateInput.includes('T') ? new Date(dateInput.replace(/-/g, '/')) : new Date(dateInput))
    : dateInput;
  if (isNaN(date.getTime())) return typeof dateInput === 'string' ? dateInput : '';
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dayName = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  
  return `${year}年${month}月${day}日(${dayName})`;
};

/**
 * カレンダー表示用の月間情報を取得します
 */
export const getMonthInfo = (year: number, month: number) => {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const info = [];

  // 前月の空白部分
  for (let i = 0; i < firstDay; i++) {
    info.push({ day: 0, dateStr: '', empty: true });
  }

  // 今月の日付
  for (let i = 1; i <= daysInMonth; i++) {
    const date = new Date(year, month, i);
    const dateStr = getDateStr(date);
    info.push({
      day: i,
      dateStr,
      isH: isHoliday(date) || date.getDay() === 0,
      empty: false
    });
  }

  return info;
};

/**
 * 氏名の表記を正規化します（前後の空白削除など）
 */
export const normalizeName = (name: string): string => {
  if (!name) return '';
  return name.trim();
};
