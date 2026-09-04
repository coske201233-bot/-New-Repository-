/**
 * 年休計算ユーティリティ
 * 通常職員: 1日 = 7.75時間 (1/1起算)
 * 会計年度職員: 1日 = 7.50時間 (4/1起算)
 */

import { getDayType, normalizeDateStr } from './dateUtils';

export const HOURS_PER_DAY = 7.75;
export const FISCAL_YEAR_HOURS_PER_DAY = 7.5;

export const normalizeName = (name: string): string => {
  if (!name || typeof name !== 'string') return '';
  let n = name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '');
  n = n.replace(/條/g, '条').replace(/齊/g, '斉').replace(/齋/g, '斎');
  return n.toUpperCase();
};

// イニシャルと実名のエイリアスマッピング表（過去の氏名表記揺れ・UUID未設定レコードの完全救済用）
const STAFF_ALIASES: Record<string, string[]> = {
  'SA': ['SA', '佐久間'],
  'YS': ['YS', '吉田'],
  'SC': ['SC', '坂下'],
  'MI': ['MI', '三井', '三井諒'],
  'AE': ['AE', '阿部'],
  'FU': ['FU', '藤森', '藤森渓', '藤森 渓'],
  'SS': ['SS', '佐藤公貴', '佐藤 公貴', '佐藤公'],
  'SK': ['SK', '佐藤'],
  'NA': ['NA', '中野'],
  'KO': ['KO'],
  'MA': ['MA'],
  '小笠原': ['小笠原'],
  '森田': ['森田'],
  '大沼': ['大沼'],
  '辻': ['辻'],
  '久保田': ['久保田'],
  '鈴木': ['鈴木'],
  '山川': ['山川'],
  '南條': ['南條', '南条'],
};

/**
 * 役職/職種に基づき1日あたりの勤務時間（年休換算率）を取得します
 */
export const getLeaveHoursPerDay = (position?: string): number => {
  if (!position) return HOURS_PER_DAY;
  return position.includes('会計年度') ? FISCAL_YEAR_HOURS_PER_DAY : HOURS_PER_DAY;
};

/**
 * 総時間を「〇日〇.〇〇時間」の文字列にフォーマットします
 */
export const formatRemainingLeave = (totalHours: number, positionOrRate?: string | number): string => {
  if (isNaN(totalHours)) return '0日0.00時間';
  
  const rate = typeof positionOrRate === 'number' 
    ? positionOrRate 
    : getLeaveHoursPerDay(positionOrRate);
  
  const isNegative = totalHours < 0;
  const absHours = Math.abs(totalHours);
  
  const days = Math.floor(absHours / rate);
  const rawRemainingHours = absHours - (days * rate);
  const hours = Math.round(rawRemainingHours * 100) / 100;
  
  const formattedStr = `${days}日${hours.toFixed(2)}時間`;
  return isNegative ? `-${formattedStr}` : formattedStr;
};

/**
 * 該当する申請の日付が起算期間内（通常職員: 1月1日〜, 会計年度職員: 4月1日〜）に含まれるか判定します
 */
export const isLeaveDateInFiscalPeriod = (
  dateStr?: string, 
  isFiscalYear: boolean = false, 
  referenceDate: Date = new Date()
): boolean => {
  if (!dateStr) return true;
  
  const cleanDateStr = dateStr.split('T')[0];
  const d = new Date(cleanDateStr.replace(/-/g, '/'));
  if (isNaN(d.getTime())) return true;

  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth() + 1;

  if (isFiscalYear) {
    // 会計年度職員: 4月1日〜
    const fiscalStartYear = currentMonth >= 4 ? currentYear : currentYear - 1;
    const startDate = new Date(fiscalStartYear, 3, 1); // 4月1日
    return d >= startDate;
  } else {
    // 通常職員: 1月1日〜
    const startDate = new Date(currentYear, 0, 1); // 1月1日
    return d >= startDate;
  }
};

/**
 * スタッフと申請レコードの一致判定 (UUID最優先 ＋ メール/エイリアス/名前照合)
 */
export const isStaffMatchRequest = (staffOrId: any, request: any): boolean => {
  if (!staffOrId || !request) return false;

  const targetId = typeof staffOrId === 'string' ? staffOrId : (staffOrId?.id || staffOrId?.userId || staffOrId?.user_id);
  const targetName = typeof staffOrId === 'object' ? normalizeName(staffOrId?.name || '') : normalizeName(staffOrId);
  const targetEmail = typeof staffOrId === 'object' ? (staffOrId?.email || '').toLowerCase() : '';
  const emailPrefix = targetEmail ? targetEmail.split('@')[0].toUpperCase() : '';

  // 1. UUID マッチング (最優先)
  const rId = request.staffId || request.staff_id || request.userId || request.user_id;
  if (targetId && rId && String(targetId) === String(rId)) {
    return true;
  }

  // レコードID内にUUIDが含まれている場合の判定
  const reqRecordId = String(request.id || '');
  if (targetId && reqRecordId.includes(String(targetId))) {
    return true;
  }

  // 2. 申請側の名前取得
  const rStaffNameRaw = request.staffName || request.staff_name || request.name || '';
  const rStaffName = normalizeName(rStaffNameRaw);
  if (!rStaffName) return false;

  // 3. 名前完全一致
  if (targetName && rStaffName === targetName) {
    return true;
  }

  // 4. メールプレフィックス一致 (例: sa, ys, morita, kubota)
  if (emailPrefix && rStaffName === emailPrefix) {
    return true;
  }

  // 5. エイリアスマッピング照合 (SA <=> 佐久間, YS <=> 吉田, MI <=> 三井 など)
  const rawStaffName = typeof staffOrId === 'object' ? (staffOrId?.name || '') : staffOrId;
  const aliases = STAFF_ALIASES[rawStaffName] || [rawStaffName];
  if (aliases.some(a => normalizeName(a) === rStaffName)) {
    return true;
  }

  return false;
};

/**
 * 承認された申請リストから消化年休時間数を計算します (カレンダー表示と完全一致する日別優先度解決エンジン)
 */
export const calculateUsedLeaveHours = (
  requests: any[], 
  staffOrId?: any, 
  position?: string
): number => {
  if (!Array.isArray(requests) || !staffOrId) return 0;

  const pos = typeof staffOrId === 'object' ? (staffOrId?.position || staffOrId?.role || position) : position;
  const hoursPerDay = getLeaveHoursPerDay(pos);
  const isFiscalYear = pos ? pos.includes('会計年度') : false;

  // カレンダー画面と同一の日付別最優先レコード解決 (Day Map)
  const dayMap = new Map<string, any>();

  const isManualEntry = (rec: any) => {
    if (!rec) return false;
    if (rec.is_manual === true || rec.isManual === true || rec.details?.isManual === true) return true;
    if (rec.is_manual === false || rec.isManual === false || rec.details?.isManual === false || rec.details?.isAuto === true) return false;
    const idStr = String(rec.id || '');
    return idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('req-');
  };

  const getTime = (i: any) => {
    const t = i?.updatedAt || i?.updated_at || i?.createdAt || i?.created_at || 0;
    return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
  };

  requests.forEach(r => {
    if (!r || !r.date || r.status === 'rejected' || r.status === 'deleted') return;
    if (!isLeaveDateInFiscalPeriod(r.date, isFiscalYear)) return;
    if (!isStaffMatchRequest(staffOrId, r)) return;

    const dateKey = String(r.date).substring(0, 10);
    const existing = dayMap.get(dateKey);

    let isBetter = false;
    if (!existing) {
      isBetter = true;
    } else {
      const isManNew = isManualEntry(r);
      const wasManOld = isManualEntry(existing);

      if (isManNew && !wasManOld) {
        isBetter = true;
      } else if (!isManNew && wasManOld) {
        isBetter = false;
      } else if (isManNew && wasManOld) {
        isBetter = getTime(r) > getTime(existing);
      } else {
        const isOffNew = !['出勤', '日勤', '特別出勤'].includes(r?.type);
        const isOffOld = !['出勤', '日勤', '特別出勤'].includes(existing?.type);
        isBetter = isOffNew && !isOffOld;
      }
    }

    if (isBetter) {
      dayMap.set(dateKey, r);
    }
  });

  let totalUsedHours = 0;

  dayMap.forEach((r) => {
    const rawType = (r.type || r.shiftType || '').trim();
    let type = rawType;
    if (type === '時間給' || type === '時間給2') type = '時間休';

    const hours = Number(r.hours ?? r.duration ?? r.details?.duration ?? r.details?.hours ?? 0);

    // 【1】全日年休
    if (['年休', '有給休暇', '有休', '年給', '有給'].includes(type)) {
      totalUsedHours += hoursPerDay;
    } 
    // 【2】時間休 (0.25h単位、指定時間数)
    else if (type === '時間休') {
      const h = hours > 0 ? hours : 1.0;
      totalUsedHours += (isNaN(h) ? 0 : h);
    } 
    // 【3】特休＋時間休 / 振替＋時間休 (時間休部分のみを年休から消化)
    else if (type === '特休＋時間休' || type === '振替＋時間休') {
      const h = Number(r.details?.hourlyHours ?? r.hourlyHours ?? (type === '振替＋時間休' && r.hours ? Math.max(0, r.hours - 4) : 0));
      totalUsedHours += (isNaN(h) ? 0 : h);
    } 
    // 【4】午前休
    else if (type === '午前休') {
      totalUsedHours += 4.0;
    } 
    // 【5】午後休
    else if (type === '午後休') {
      totalUsedHours += (isFiscalYear ? 3.5 : 3.75);
    }
  });

  return totalUsedHours;
};

/**
 * ユーザーの残り年休時間数を算出します (UUID優先)
 */
export const calculateRemainingLeaveHours = (
  initialDays: number = 20, 
  requests: any[], 
  staffOrId?: any,
  position?: string
): number => {
  const pos = typeof staffOrId === 'object' ? (staffOrId?.position || staffOrId?.role || position) : position;
  const hoursPerDay = getLeaveHoursPerDay(pos);
  const initialTotalHours = (Number(initialDays) || 20) * hoursPerDay;
  const usedHours = calculateUsedLeaveHours(requests, staffOrId, position);
  return initialTotalHours - usedHours;
};

export interface MandatoryLeaveStatus {
  usedHours: number;      // 取得済み年休・時間休合計時間
  targetHours: number;    // 目標時間数 (38.75h または 37.50h)
  neededHours: number;    // 残り必要な時間数
  isCompleted: boolean;   // 5日分(目標時間)達成済みか
  displayText: string;    // 個人カード用表示テキスト
}

/**
 * 年休5日必修化のカウント＆判定メイン関数（合計時間判定・要年休〇時間表示）
 */
export const calculateMandatoryLeaveStatus = (
  staff: { id?: string; name?: string; position?: string; role?: string; email?: string },
  requests: any[],
  referenceYear: number = new Date().getFullYear()
): MandatoryLeaveStatus => {
  const pos = `${staff.position || ''} ${staff.role || ''}`;
  const isFiscalYear = pos.includes('会計年度');
  
  // 1日あたり年休換算率: 通常 7.75h, 会計年度 7.5h
  const hoursPerDay = isFiscalYear ? FISCAL_YEAR_HOURS_PER_DAY : HOURS_PER_DAY;
  
  // 目標時間数: 通常 38.75h (7.75 × 5), 会計年度 37.50h (7.5 × 5)
  const targetHours = hoursPerDay * 5.0;

  // カレンダー画面と同一の日付別最優先レコード解決 (Day Map)
  const dayMap = new Map<string, any>();

  const isManualEntry = (rec: any) => {
    if (!rec) return false;
    if (rec.is_manual === true || rec.isManual === true || rec.details?.isManual === true) return true;
    if (rec.is_manual === false || rec.isManual === false || rec.details?.isManual === false || rec.details?.isAuto === true) return false;
    const idStr = String(rec.id || '');
    return idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('req-');
  };

  const getTime = (i: any) => {
    const t = i?.updatedAt || i?.updated_at || i?.createdAt || i?.created_at || 0;
    return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
  };

  (requests || []).forEach(r => {
    if (!r || !r.date || r.status === 'rejected' || r.status === 'deleted') return;

    const dateStr = (r.date || '').split('T')[0];
    if (!dateStr) return false;
    const d = new Date(dateStr.replace(/-/g, '/'));
    if (d.getFullYear() !== referenceYear) return;

    if (!isStaffMatchRequest(staff, r)) return;

    const dateKey = dateStr;
    const existing = dayMap.get(dateKey);

    let isBetter = false;
    if (!existing) {
      isBetter = true;
    } else {
      const isManNew = isManualEntry(r);
      const wasManOld = isManualEntry(existing);

      if (isManNew && !wasManOld) {
        isBetter = true;
      } else if (!isManNew && wasManOld) {
        isBetter = false;
      } else if (isManNew && wasManOld) {
        isBetter = getTime(r) > getTime(existing);
      } else {
        const isOffNew = !['出勤', '日勤', '特別出勤'].includes(r?.type);
        const isOffOld = !['出勤', '日勤', '特別出勤'].includes(existing?.type);
        isBetter = isOffNew && !isOffOld;
      }
    }

    if (isBetter) {
      dayMap.set(dateKey, r);
    }
  });

  let usedHours = 0;

  dayMap.forEach((r) => {
    const rawType = (r.type || r.shiftType || '').trim();
    let type = rawType;
    if (type === '時間給' || type === '時間給2') type = '時間休';

    const hours = Number(r.hours ?? r.duration ?? r.details?.duration ?? r.details?.hours ?? 0);

    // 【1】年休 (1日分)
    if (['年休', '有給休暇', '年給', '有休', '有給'].includes(type)) {
      usedHours += hoursPerDay;
    }
    // 【2】時間休 (指定時間数)
    else if (type === '時間休') {
      usedHours += (hours > 0 ? hours : 1.0);
    }
    // 【3】特休＋時間休 / 振替＋時間休 (時間休部分のみ)
    else if (type === '特休＋時間休' || type === '振替＋時間休') {
      const h = Number(r.details?.hourlyHours ?? r.hourlyHours ?? (type === '振替＋時間休' && r.hours ? Math.max(0, r.hours - 4) : 0));
      usedHours += (isNaN(h) ? 0 : h);
    }
    // 【4】午前休
    else if (type === '午前休') {
      usedHours += 4.0;
    }
    // 【5】午後休
    else if (type === '午後休') {
      usedHours += (isFiscalYear ? 3.5 : 3.75);
    }
  });

  // 残り必要時間数の計算（目標時間 - 取得合計時間）
  const neededHours = Math.max(0, targetHours - usedHours);
  const isCompleted = neededHours <= 0;

  // カード表示用テキストの生成
  let displayText = '';
  if (isCompleted) {
    displayText = '年休5日取得済み';
  } else {
    // 時間数表示 (小数点以下の不要な0は整理、例: 要年休4.5時間, 要年休7.75時間)
    const formattedNeeded = neededHours % 1 === 0 ? String(neededHours) : neededHours.toFixed(2);
    displayText = `要年休${formattedNeeded}時間`;
  }

  return {
    usedHours,
    targetHours,
    neededHours,
    isCompleted,
    displayText
  };
};

export interface AnnualLeaveRateResult {
  grantedDays: number;       // 付与年休日数 (例: 20)
  usedDays: number;          // 取得日数 (例: 13.5)
  usedFullDays: number;      // 年休(全日)の取得回数 (例: 12)
  usedHourlyHours: number;   // 時間休の取得合計時間 (例: 11.625)
  usedHourlyDays: number;    // 時間休の日数換算 (例: 1.5)
  ratePercent: number;       // 取得率 % (例: 67.5)
  ratePercentStr: string;    // '67.5%' または '0.0%' または '-'
  displayText: string;       // '年休取得率 67.5% (取得 13.5日 / 付与 20日)'
  statusColor: string;       // #34d399, #38bdf8, #f59e0b, #f87171
  isMandatoryMet: boolean;   // 5日必修(5.0日以上)達成済みか
}

/**
 * 年休取得率（付与年休に対する消化率 %）および取得日数・付与日数を計算します
 * 集計対象は「年休（1.0日）」と「時間休（実時間/所定時間 換算）」のみに限定
 */
export const calculateAnnualLeaveRate = (
  staff: { id?: string; name?: string; position?: string; role?: string; email?: string; initial_leave_days?: number; initialLeaveDays?: number } | any,
  requests: any[],
  referenceYear: number = new Date().getFullYear(),
  customInitialDays?: number
): AnnualLeaveRateResult => {
  const pos = typeof staff === 'object' ? `${staff?.position || ''} ${staff?.role || ''}` : '';
  const isFiscalYear = pos.includes('会計年度');
  const hoursPerDay = isFiscalYear ? FISCAL_YEAR_HOURS_PER_DAY : HOURS_PER_DAY;

  // 付与日数の取得
  let grantedDays = 0;
  if (customInitialDays !== undefined && !isNaN(customInitialDays)) {
    grantedDays = Number(customInitialDays);
  } else if (staff && typeof staff === 'object') {
    let savedVal: number | null = null;
    if (typeof window !== 'undefined') {
      const s1 = localStorage.getItem(`initial_leave_days_${staff.id}`);
      const s2 = localStorage.getItem(`initial_leave_days_${staff.email}`);
      const s3 = localStorage.getItem(`initial_leave_days_${staff.name}`);
      if (s1 !== null && !isNaN(parseFloat(s1))) savedVal = parseFloat(s1);
      else if (s2 !== null && !isNaN(parseFloat(s2))) savedVal = parseFloat(s2);
      else if (s3 !== null && !isNaN(parseFloat(s3))) savedVal = parseFloat(s3);
    }
    if (savedVal !== null) {
      grantedDays = savedVal;
    } else if (staff.initial_leave_days !== undefined && staff.initial_leave_days !== null && !isNaN(Number(staff.initial_leave_days))) {
      grantedDays = Number(staff.initial_leave_days);
    } else if (staff.initialLeaveDays !== undefined && staff.initialLeaveDays !== null && !isNaN(Number(staff.initialLeaveDays))) {
      grantedDays = Number(staff.initialLeaveDays);
    } else {
      grantedDays = 20;
    }
  } else {
    grantedDays = 20;
  }

  // カレンダー画面と同一の日付別最優先レコード解決 (Day Map)
  const dayMap = new Map<string, any>();

  const isManualEntry = (rec: any) => {
    if (!rec) return false;
    if (rec.is_manual === true || rec.isManual === true || rec.details?.isManual === true) return true;
    if (rec.is_manual === false || rec.isManual === false || rec.details?.isManual === false || rec.details?.isAuto === true) return false;
    const idStr = String(rec.id || '');
    return idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('req-');
  };

  const getTime = (i: any) => {
    const t = i?.updatedAt || i?.updated_at || i?.createdAt || i?.created_at || 0;
    return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
  };

  (requests || []).forEach(r => {
    if (!r || !r.date || r.status === 'rejected' || r.status === 'deleted' || r.status === '却下' || r.status === '削除') return;

    const dateStr = (r.date || '').split('T')[0];
    if (!dateStr) return;
    const d = new Date(dateStr.replace(/-/g, '/'));
    if (d.getFullYear() !== referenceYear) return;

    if (!isStaffMatchRequest(staff, r)) return;

    const dateKey = dateStr;
    const existing = dayMap.get(dateKey);

    let isBetter = false;
    if (!existing) {
      isBetter = true;
    } else {
      const isManNew = isManualEntry(r);
      const wasManOld = isManualEntry(existing);

      if (isManNew && !wasManOld) {
        isBetter = true;
      } else if (!isManNew && wasManOld) {
        isBetter = false;
      } else if (isManNew && wasManOld) {
        isBetter = getTime(r) > getTime(existing);
      } else {
        const isOffNew = !['出勤', '日勤', '特別出勤'].includes(r?.type);
        const isOffOld = !['出勤', '日勤', '特別出勤'].includes(existing?.type);
        isBetter = isOffNew && !isOffOld;
      }
    }

    if (isBetter) {
      dayMap.set(dateKey, r);
    }
  });

  let usedFullDays = 0;
  let usedHourlyHours = 0;

  dayMap.forEach((r) => {
    const rawType = (r.type || r.shiftType || '').trim();
    let type = rawType;
    if (type === '時間給' || type === '時間給2') type = '時間休';

    // 【1】年休 (1回につき 1.0日)
    if (['年休', '有給休暇', '有休', '年給', '有給'].includes(type)) {
      usedFullDays += 1.0;
    }
    // 【2】時間休 (取得時間に応じた日数換算)
    else if (type === '時間休') {
      const hours = Number(r.hours ?? r.duration ?? r.details?.duration ?? r.details?.hours ?? 0);
      const validHours = hours > 0 ? hours : 1.0;
      usedHourlyHours += validHours;
    }
    // 【3】特休＋時間休 / 振替＋時間休 (時間休部分のみを時間単位年休として消化)
    else if (type === '特休＋時間休' || type === '振替＋時間休') {
      const h = Number(r.details?.hourlyHours ?? r.hourlyHours ?? (type === '振替＋時間休' && r.hours ? Math.max(0, r.hours - 4) : 0));
      usedHourlyHours += (isNaN(h) ? 0 : h);
    }
    // ※特休、公休、振替休、振替4、夏季休暇、午前休、午後休等は除外
  });

  const usedHourlyDays = usedHourlyHours / hoursPerDay;
  const rawUsedDays = usedFullDays + usedHourlyDays;
  const usedDays = Math.round(rawUsedDays * 10) / 10;

  let ratePercent = 0;
  let ratePercentStr = '-';
  if (grantedDays > 0) {
    ratePercent = Math.round((rawUsedDays / grantedDays) * 1000) / 10;
    ratePercentStr = `${ratePercent.toFixed(1)}%`;
  } else {
    ratePercent = 0;
    ratePercentStr = '0.0%';
  }

  const isMandatoryMet = rawUsedDays >= 5.0;

  let statusColor = '#f87171'; // 遅れ (赤/ローズ)
  if (ratePercent >= 70 || isMandatoryMet) {
    statusColor = '#34d399'; // グリーン (目標達成・高取得率)
  } else if (ratePercent >= 40) {
    statusColor = '#38bdf8'; // スカイブルー (順調)
  } else if (ratePercent >= 20) {
    statusColor = '#f59e0b'; // アンバー (やや遅れ)
  }

  const formattedUsedDays = usedDays % 1 === 0 ? usedDays.toFixed(0) : usedDays.toFixed(1);
  const formattedGrantedDays = grantedDays % 1 === 0 ? grantedDays.toFixed(0) : grantedDays.toFixed(1);
  const displayText = `年休取得率 ${ratePercentStr} (取得 ${formattedUsedDays}日 / 付与 ${formattedGrantedDays}日)`;

  return {
    grantedDays,
    usedDays,
    usedFullDays,
    usedHourlyHours,
    usedHourlyDays: Math.round(usedHourlyDays * 100) / 100,
    ratePercent,
    ratePercentStr,
    displayText,
    statusColor,
    isMandatoryMet
  };
};

/**
 * 会計年度職員（雇用形態）の判定
 * スタッフの isAssistant、isAccountingYear、雇用形態フラグ、職種/役職定義等を参照
 */
export function isAccountingYearStaff(staff: any): boolean {
  if (!staff) return false;
  if (staff.isAccountingYear === true || staff.is_accounting_year === true) return true;
  if (staff.isAssistant === true) return true;
  
  const pos = String(staff.position || staff.title || '').trim();
  const role = String(staff.role || '').trim();
  const job = String(staff.jobType || staff.profession || staff.job || '').trim();
  const placement = String(staff.placement || '').trim();
  const status = String(staff.status || staff.employmentType || staff.employment_type || '').trim();

  if (pos.includes('会計年度') || role.includes('会計年度') || job.includes('会計年度') || status.includes('会計年度')) return true;
  if (job === '助手' || role === '助手' || pos === '助手' || placement === '助手') return true;

  return false;
}

/**
 * 時間数を「〇〇.〇h」形式にフォーマットします
 */
export function formatNonWorkingHours(hours: number): string {
  if (isNaN(hours) || hours <= 0) return '0.0h';
  const rounded = Math.round(hours * 100) / 100;
  if (rounded % 1 === 0) {
    return `${rounded.toFixed(1)}h`;
  }
  return `${rounded}h`;
}

/**
 * 時間休レコードから正確な時間数をパース・取得します (カレンダー表示・StaffScreen表示と完全一致)
 * 
 * 優先順位:
 * details.hourlyHours -> hourlyHours -> details.partialLeaveHours -> partialLeaveHours ->
 * details.duration -> hours -> duration -> details.hours
 * 
 * ※固定値（7.75h/8.0h/4.0h）の誤混入を完全に防止します
 */
export function parseHourlyLeaveHours(r: any): number {
  if (!r) return 0;

  const rawH = r.details?.hourlyHours ?? 
               r.hourlyHours ?? 
               r.details?.partialLeaveHours ?? 
               r.partialLeaveHours ?? 
               r.details?.duration ?? 
               r.hours ?? 
               r.duration ??
               r.details?.hours;

  if (rawH !== undefined && rawH !== null && rawH !== '') {
    const parsedH = parseFloat(String(rawH));
    if (!isNaN(parsedH) && parsedH > 0) {
      return parsedH;
    }
  }

  return 0;
}

export interface NonWorkingHoursBreakdown {
  annualLeaveHours: number;    // 1. 年休 (常勤: 7.75h, 会計年度: 7.5h)
  specialLeaveHours: number;   // 2. 特休 (登録時間、終日なら 7.75h / 7.5h)
  hourlyLeaveHours: number;    // 3. 時間休 (登録時間)
  summerLeaveHours: number;    // 4. 夏季休暇 (常勤: 7.75h, 会計年度: 0h)
  furikae4Hours: number;       // 5. 振替4 (4.0h)
  furikaeHourlyHours: number;  // 6. 振替＋時間休 (4.0h ＋ 登録された時間休の時間数)
  specialHourlyHours: number;  // 7. 特休＋時間休 (特休時間数 ＋ 時間休時間数)
  weekdayTripHours: number;    // 8. 平日の出張 (平日の出張のみ登録時間、終日は 7.75h / 7.5h)
  totalHours: number;          // 合計時間
  totalHoursStr: string;       // フォーマット文字列 (例: '31.0h')
}

export interface StaffMonthlyNonWorkingHoursResult {
  staff: any;
  isFiscalYear: boolean;
  totalHours: number;
  totalHoursStr: string;
  breakdown: NonWorkingHoursBreakdown;
  itemCount: number; // 該当日数・件数
}

/**
 * スタッフごとの月別「勤務を要しない時間」を算出します
 * 
 * 【算出ルール】
 * 1. 年休: 常勤: 7.75h / 会計年度: 7.5h
 * 2. 特休: 登録時間（終日の場合は 常勤: 7.75h / 会計年度: 7.5h）
 * 3. 時間休: 登録時間
 * 4. 夏季休暇: 常勤: 7.75h / 会計年度: 0h（加算対象外）
 * 5. 振替4: 4.0h
 * 6. 振替＋時間休: 4.0h ＋ 登録された時間休の時間数
 * 7. 特休＋時間休: 特休時間数 ＋ 時間休時間数
 * 8. 平日の出張: 土日祝は除外。平日の出張のみ登録時間（終日の場合は 常勤: 7.75h / 会計年度: 7.5h）を加算
 * 
 * ※公休（週休）、休日出勤、通常の出勤は対象外
 */
export function calculateStaffMonthlyNonWorkingHours(
  staff: any,
  allCalendarData: any[],
  year: number,
  month: number
): StaffMonthlyNonWorkingHoursResult {
  const isFiscal = isAccountingYearStaff(staff);
  const fullDayHours = isFiscal ? FISCAL_YEAR_HOURS_PER_DAY : HOURS_PER_DAY; // 7.5 or 7.75

  const breakdown: NonWorkingHoursBreakdown = {
    annualLeaveHours: 0,
    specialLeaveHours: 0,
    hourlyLeaveHours: 0,
    summerLeaveHours: 0,
    furikae4Hours: 0,
    furikaeHourlyHours: 0,
    specialHourlyHours: 0,
    weekdayTripHours: 0,
    totalHours: 0,
    totalHoursStr: '0.0h',
  };

  if (!staff || !Array.isArray(allCalendarData)) {
    return {
      staff,
      isFiscalYear: isFiscal,
      totalHours: 0,
      totalHoursStr: '0.0h',
      breakdown,
      itemCount: 0,
    };
  }

  const daysInMonth = new Date(year, month, 0).getDate();

  // 無効・却下・削除・キャンセル済みレコード判定ヘルパー
  const isInvalidRecord = (r: any): boolean => {
    if (!r) return true;
    const st = String(r.status || '').trim().toLowerCase();
    const detailSt = String(r.details?.status || '').trim().toLowerCase();
    const invalidList = [
      'deleted', '削除',
      'rejected', '却下',
      'canceled', 'cancelled', 'キャンセル', '取り消し', '申請取消'
    ];
    if (invalidList.includes(st) || invalidList.includes(detailSt)) return true;
    return false;
  };

  // 真実のソースである requests テーブル等から無効化された ID を抽出
  const rejectedOrDeletedIds = new Set(
    allCalendarData
      .filter(isInvalidRecord)
      .map(r => String(r.id || ''))
      .filter(Boolean)
  );

  const isManualEntry = (rec: any): boolean => {
    if (!rec) return false;
    if (rec.is_manual === true || rec.isManual === true || rec.details?.isManual === true) return true;
    if (rec.is_manual === false || rec.isManual === false || rec.details?.isManual === false || rec.details?.isAuto === true) return false;
    const idStr = String(rec.id || '');
    return idStr.startsWith('m-') || idStr.startsWith('req-');
  };

  const getTime = (i: any): number => {
    const t = i?.updatedAt || i?.updated_at || i?.createdAt || i?.created_at || 0;
    return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
  };

  let itemCount = 0;
  const staffName = staff.name || '';
  const isTargetStaffLog = staffName.includes('TI') || staffName.includes('Ti') || staffName.includes('ti') || String(staff.id || '').includes('TI');

  if (isTargetStaffLog) {
    console.log(`[NonWorkingHours Audit Start] Staff: ${staffName} (${year}年${month}月)`);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const targetDateStr = normalizeDateStr(dStr);
    const dDate = new Date(year, month - 1, d);
    const dayType = getDayType(dDate); // 'weekday' | 'sat' | 'sun' | 'holiday'

    // 対象スタッフ・該当日の有効レコードを抽出（削除・却下・キャンセルは完全除外）
    const dayRecords = allCalendarData.filter(r => {
      if (!r || !r.date) return false;
      if (isInvalidRecord(r)) return false;
      const rId = String(r.id || '');
      const reqId = String(r.requestId || r.request_id || '');
      if (rId && rejectedOrDeletedIds.has(rId)) return false;
      if (reqId && rejectedOrDeletedIds.has(reqId)) return false;
      if (normalizeDateStr(r.date) !== targetDateStr) return false;
      return isStaffMatchRequest(staff, r);
    });

    if (dayRecords.length === 0) continue;

    // 【StaffScreen.tsx と完全一致する日別最優先確定シフト解決エンジン】
    // 手動入力は自動入力を上書き、手動同士は更新日時が新しい方を優先
    let resolvedShift: any = null;

    for (const r of dayRecords) {
      if (!resolvedShift) {
        resolvedShift = r;
        continue;
      }

      const isManNew = isManualEntry(r);
      const wasManOld = isManualEntry(resolvedShift);

      let isBetter = false;
      if (isManNew && !wasManOld) {
        isBetter = true; // 手動は常に自動を上書き
      } else if (!isManNew && wasManOld) {
        isBetter = false; // 自動は手動を上書きできない
      } else if (isManNew && wasManOld) {
        // 共に手動の場合は更新日時が新しい方を優先
        isBetter = getTime(r) > getTime(resolvedShift);
      } else {
        // 共に自動の場合は休み（出勤・日勤・特別出勤以外）を優先
        const isOffNew = !['出勤', '日勤', '特別出勤'].includes(r?.type || r?.shiftType);
        const isOffOld = !['出勤', '日勤', '特別出勤'].includes(resolvedShift?.type || resolvedShift?.shiftType);
        isBetter = isOffNew && !isOffOld;
      }

      if (isBetter) {
        resolvedShift = r;
      }
    }

    if (!resolvedShift) continue;

    const rawType = String(resolvedShift.type || resolvedShift.shiftType || '').trim();
    let addedHours = 0;
    let counted = false;

    // 1. 出勤・日勤・特別出勤・公休（週休）・休日出勤は勤務を要しない時間には加算しない (0h)
    if (['出勤', '日勤', '特別出勤', '公休', '休日出勤'].includes(rawType)) {
      addedHours = 0;
    }
    // 2. 年休 (通常: 7.75h, 会計年度: 7.5h)
    else if (['年休', '有給休暇', '有休', '年給', '有給'].includes(rawType)) {
      addedHours = fullDayHours;
      breakdown.annualLeaveHours += fullDayHours;
      counted = true;
    }
    // 3. 特休 (登録時間。終日の場合は 常勤: 7.75h / 会計年度: 7.5h)
    else if (rawType === '特休') {
      const rawH = resolvedShift.details?.specialHours ?? resolvedShift.specialHours ?? resolvedShift.details?.duration ?? resolvedShift.hours ?? resolvedShift.duration ?? resolvedShift.details?.hours;
      const parsedH = (rawH !== undefined && rawH !== null && rawH !== '') ? parseFloat(String(rawH)) : null;
      let h = fullDayHours;
      if (parsedH !== null && !isNaN(parsedH) && parsedH > 0 && parsedH < fullDayHours) {
        h = parsedH;
      }
      addedHours = h;
      breakdown.specialLeaveHours += h;
      counted = true;
    }
    // 4. 時間休 (登録時間: カレンダー表示と完全一致するパース関数を使用)
    else if (['時間休', '時間給', '時間給2'].includes(rawType)) {
      const h = parseHourlyLeaveHours(resolvedShift);
      if (h > 0) {
        addedHours = h;
        breakdown.hourlyLeaveHours += h;
        counted = true;
      }
    }
    // 5. 夏季休暇 (通常: 7.75h, 会計年度: 0h)
    else if (['夏季休暇', '夏期休暇', '夏休'].includes(rawType)) {
      if (!isFiscal) {
        addedHours = HOURS_PER_DAY; // 7.75h
        breakdown.summerLeaveHours += HOURS_PER_DAY;
        counted = true;
      }
    }
    // 6. 振替4 (4.0h)
    else if (['振替4', '振4'].includes(rawType)) {
      addedHours = 4.0;
      breakdown.furikae4Hours += 4.0;
      counted = true;
    }
    // 7. 振替＋時間休 (4.0h ＋ 登録された時間休の時間数)
    else if (rawType === '振替＋時間休') {
      const hrHours = Number(resolvedShift.details?.hourlyHours ?? resolvedShift.hourlyHours ?? (resolvedShift.hours && resolvedShift.hours > 4 ? resolvedShift.hours - 4 : 0));
      const validHr = (!isNaN(hrHours) && hrHours > 0) ? hrHours : 0;
      addedHours = 4.0 + validHr;
      breakdown.furikaeHourlyHours += addedHours;
      counted = true;
    }
    // 8. 特休＋時間休 (特休時間数 ＋ 時間休時間数)
    else if (rawType === '特休＋時間休') {
      const spHours = Number(resolvedShift.details?.specialHours ?? resolvedShift.specialHours ?? 0);
      const hrHours = Number(resolvedShift.details?.hourlyHours ?? resolvedShift.hourlyHours ?? 0);
      let h = 0;
      if (!isNaN(spHours) && !isNaN(hrHours) && (spHours > 0 || hrHours > 0)) {
        h = spHours + hrHours;
      } else if (resolvedShift.hours && !isNaN(Number(resolvedShift.hours)) && Number(resolvedShift.hours) > 0) {
        h = Number(resolvedShift.hours);
      } else {
        h = fullDayHours;
      }
      addedHours = h;
      breakdown.specialHourlyHours += h;
      counted = true;
    }
    // 9. 平日の出張 (土日祝は除外。平日の出張のみ登録時間、終日は 常勤: 7.75h / 会計年度: 7.5h)
    else if (rawType === '出張') {
      if (dayType === 'weekday') {
        const rawH = resolvedShift.details?.duration ?? resolvedShift.hours ?? resolvedShift.duration ?? resolvedShift.details?.hours;
        const parsedH = (rawH !== undefined && rawH !== null && rawH !== '') ? parseFloat(String(rawH)) : null;
        let h = fullDayHours;
        if (parsedH !== null && !isNaN(parsedH) && parsedH > 0 && parsedH < fullDayHours) {
          h = parsedH;
        }
        addedHours = h;
        breakdown.weekdayTripHours += h;
        counted = true;
      }
    }
    // 10. 午前休 / 午後休 (半休対応)
    else if (rawType === '午前休') {
      addedHours = 4.0;
      breakdown.hourlyLeaveHours += 4.0;
      counted = true;
    }
    else if (rawType === '午後休') {
      const h = isFiscal ? 3.5 : 3.75;
      addedHours = h;
      breakdown.hourlyLeaveHours += h;
      counted = true;
    }

    if (counted) itemCount++;

    if (isTargetStaffLog && (addedHours > 0 || ['出勤', '日勤'].includes(rawType))) {
      console.log(`[NonWorkingHours Audit] ${staffName} ${targetDateStr}: type="${rawType}", added=${addedHours}h, isManual=${isManualEntry(resolvedShift)}, id="${resolvedShift.id || ''}"`);
    }
  }

  const rawTotal = breakdown.annualLeaveHours +
    breakdown.specialLeaveHours +
    breakdown.hourlyLeaveHours +
    breakdown.summerLeaveHours +
    breakdown.furikae4Hours +
    breakdown.furikaeHourlyHours +
    breakdown.specialHourlyHours +
    breakdown.weekdayTripHours;

  const totalHours = Math.round(rawTotal * 100) / 100;
  const totalHoursStr = formatNonWorkingHours(totalHours);

  breakdown.totalHours = totalHours;
  breakdown.totalHoursStr = totalHoursStr;

  return {
    staff,
    isFiscalYear: isFiscal,
    totalHours,
    totalHoursStr,
    breakdown,
    itemCount,
  };
}

/**
 * 全スタッフの月別「勤務を要しない時間」を一括集計します
 */
export function calculateAllStaffMonthlyNonWorkingHours(
  staffList: any[],
  allCalendarData: any[],
  year: number,
  month: number
): StaffMonthlyNonWorkingHoursResult[] {
  if (!Array.isArray(staffList)) return [];

  return staffList
    .filter(s => {
      if (!s || s.status === '無効' || s.status === '入職前') return false;
      return true;
    })
    .map(s => calculateStaffMonthlyNonWorkingHours(s, allCalendarData, year, month));
}

// ---------------------------------------------------------------------------
// 🏢 週別（平日5日間）フロア別「勤務を要しない時間」集計エンジン（所属ルールの更新）
// ---------------------------------------------------------------------------

export interface FloorAllocation {
  isExcluded: boolean;      // 事務、無効、入職前、対象外など
  floor2Ratio: number;      // 2F按分割合 (0.0 〜 1.0)
  floor4Ratio: number;      // 4F按分割合 (0.0 〜 1.0)
  categoryName: string;     // 'SC(包括)' | 'SA' | 'フォロー' | '2F' | '4F' | '2F/4F兼務' | '事務(除外)' | '対象外'
  matchReason: string;      // 判定の根拠
}

/**
 * スタッフの所属・役職からフロア振り分けおよび按分比率を判定します
 * 
 * 【ルール】
 * 1. 除外基準:
 *    - 「事務」のみを除外（役職・職種・所属等に「事務」が含まれるスタッフは集計外）
 *    - 「管理職（管理者・主任等）」であっても、2Fまたは4Fに所属している、あるいはフォローを担当している場合は集計対象に含める
 * 2. フロア振り分け・按分ルール:
 *    - SC（包括）: 全て「2Fスタッフ」として加算 (2F: 1.0)
 *    - SA: 「2F」に 0.5、「4F」に 0.5 で半分ずつ按分 (2F: 0.5, 4F: 0.5)
 *    - フォロー（所属や役職に「フォロー」が含まれるスタッフ）: 「2F」に 0.5、「4F」に 0.5 で半分ずつ按分
 *    - 2F所属スタッフ: 全て「2F」へ加算 (2F: 1.0)
 *    - 4F所属スタッフ: 全て「4F」へ加算 (4F: 1.0)
 */
export function getStaffFloorAllocation(staff: any): FloorAllocation {
  if (!staff || staff.status === '無効' || staff.status === '入職前') {
    return { isExcluded: true, floor2Ratio: 0, floor4Ratio: 0, categoryName: '無効/入職前', matchReason: 'status' };
  }

  const name = String(staff.name || '').trim();
  const normalizedName = normalizeName(name);

  // 全角英数を半角化して大文字へ変換
  const toHalfUpper = (v: any): string =>
    String(v || '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .toUpperCase()
      .trim();

  const placement = toHalfUpper(staff.placement);
  const department = toHalfUpper(staff.department);
  const affiliation = toHalfUpper(staff.affiliation);
  const role = toHalfUpper(staff.role);
  const jobType = toHalfUpper(staff.jobType);
  const profession = toHalfUpper(staff.profession);
  const position = toHalfUpper(staff.position);

  // 全属性を結合
  const combined = [placement, department, affiliation, role, jobType, profession, position].join(' ');

  // 1. 除外基準: 「事務」のみを除外（役職・職種・所属等に「事務」が含まれるスタッフは集計外）
  // ※管理職（管理者・主任等）は除外しない
  if (combined.includes('事務') || name.includes('事務')) {
    return { isExcluded: true, floor2Ratio: 0, floor4Ratio: 0, categoryName: '事務(除外)', matchReason: '事務' };
  }

  // 2. フロア振り分け・按分ルール
  // (a) SC（包括）: 全て「2Fスタッフ」として加算 (2F: 1.0)
  const isSC =
    normalizedName === 'SC' ||
    STAFF_ALIASES['SC']?.some(alias => name.includes(alias) || alias.includes(name)) ||
    combined.includes('包括') ||
    combined.includes('SC') ||
    placement.includes('包括') ||
    placement.includes('SC') ||
    role.includes('包括') ||
    role.includes('SC');

  if (isSC) {
    return { isExcluded: false, floor2Ratio: 1.0, floor4Ratio: 0.0, categoryName: 'SC(包括)', matchReason: 'SC/包括' };
  }

  // (b) SA: 「2F」に 0.5、「4F」に 0.5 で半分ずつ按分
  const isSA =
    normalizedName === 'SA' ||
    STAFF_ALIASES['SA']?.some(alias => name.includes(alias) || alias.includes(name)) ||
    name.includes('佐久間') ||
    placement === 'SA' ||
    role === 'SA' ||
    combined.includes('SA');

  if (isSA) {
    return { isExcluded: false, floor2Ratio: 0.5, floor4Ratio: 0.5, categoryName: 'SA', matchReason: 'SA' };
  }

  // (c) フォロー（所属や役職に「フォロー」が含まれるスタッフ）: 「2F」に 0.5、「4F」に 0.5 で半分ずつ按分
  const isFollow = combined.includes('フォロー') || name.includes('フォロー');
  if (isFollow) {
    return { isExcluded: false, floor2Ratio: 0.5, floor4Ratio: 0.5, categoryName: 'フォロー', matchReason: 'フォロー' };
  }

  // 2F / 4F の所属判定
  const has2F = combined.includes('2F') || combined.includes('2階');
  const has4F = combined.includes('4F') || combined.includes('4階');

  if (has2F && has4F) {
    // 2Fと4Fの兼務
    return { isExcluded: false, floor2Ratio: 0.5, floor4Ratio: 0.5, categoryName: '2F/4F兼務', matchReason: '2F+4F' };
  }

  // (d) 2F所属スタッフ: 全て「2F」へ加算 (2F: 1.0)
  if (has2F) {
    return { isExcluded: false, floor2Ratio: 1.0, floor4Ratio: 0.0, categoryName: '2F', matchReason: '2F' };
  }

  // (e) 4F所属スタッフ: 全て「4F」へ加算 (4F: 1.0)
  if (has4F) {
    return { isExcluded: false, floor2Ratio: 0.0, floor4Ratio: 1.0, categoryName: '4F', matchReason: '4F' };
  }

  // 2F・4Fいずれにも該当しない場合
  return { isExcluded: true, floor2Ratio: 0, floor4Ratio: 0, categoryName: '集計対象外', matchReason: 'フロア対象外' };
}

/**
 * 特定スタッフ・特定日（targetDateStr: 'YYYY-MM-DD'）の勤務を要しない時間を算出します
 * (確定シフト解決エンジン: 手動入力優先、最新更新日時優先、自動は休み優先)
 */
export function calculateStaffDailyNonWorkingHours(
  staff: any,
  allCalendarData: any[],
  targetDateStr: string,
  precomputedRejectedIds?: Set<string>
): { hours: number; rawType: string; resolvedShift: any } {
  if (!staff || !Array.isArray(allCalendarData) || !targetDateStr) {
    return { hours: 0, rawType: '', resolvedShift: null };
  }

  const isFiscal = isAccountingYearStaff(staff);
  const fullDayHours = isFiscal ? FISCAL_YEAR_HOURS_PER_DAY : HOURS_PER_DAY; // 7.5 or 7.75

  const normTarget = normalizeDateStr(targetDateStr);
  const parts = normTarget.split('-');
  if (parts.length < 3) return { hours: 0, rawType: '', resolvedShift: null };

  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const dDate = new Date(y, m - 1, d);
  const dayType = getDayType(dDate);

  const isInvalid = (r: any): boolean => {
    if (!r) return true;
    const st = String(r.status || '').trim().toLowerCase();
    const detailSt = String(r.details?.status || '').trim().toLowerCase();
    const invalidList = [
      'deleted', '削除',
      'rejected', '却下',
      'canceled', 'cancelled', 'キャンセル', '取り消し', '申請取消'
    ];
    return invalidList.includes(st) || invalidList.includes(detailSt);
  };

  const rejectedIds = precomputedRejectedIds || new Set(
    allCalendarData.filter(isInvalid).map(r => String(r.id || '')).filter(Boolean)
  );

  const dayRecords = allCalendarData.filter(r => {
    if (!r || !r.date) return false;
    if (isInvalid(r)) return false;
    const rId = String(r.id || '');
    const reqId = String(r.requestId || r.request_id || '');
    if (rId && rejectedIds.has(rId)) return false;
    if (reqId && rejectedIds.has(reqId)) return false;
    if (normalizeDateStr(r.date) !== normTarget) return false;
    return isStaffMatchRequest(staff, r);
  });

  if (dayRecords.length === 0) {
    return { hours: 0, rawType: '', resolvedShift: null };
  }

  const isManualEntry = (rec: any): boolean => {
    if (!rec) return false;
    if (rec.is_manual === true || rec.isManual === true || rec.details?.isManual === true) return true;
    if (rec.is_manual === false || rec.isManual === false || rec.details?.isManual === false || rec.details?.isAuto === true) return false;
    const idStr = String(rec.id || '');
    return idStr.startsWith('m-') || idStr.startsWith('req-');
  };

  const getTime = (i: any): number => {
    const t = i?.updatedAt || i?.updated_at || i?.createdAt || i?.created_at || 0;
    return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
  };

  let resolvedShift: any = null;
  for (const r of dayRecords) {
    if (!resolvedShift) {
      resolvedShift = r;
      continue;
    }

    const isManNew = isManualEntry(r);
    const wasManOld = isManualEntry(resolvedShift);

    let isBetter = false;
    if (isManNew && !wasManOld) {
      isBetter = true;
    } else if (!isManNew && wasManOld) {
      isBetter = false;
    } else if (isManNew && wasManOld) {
      isBetter = getTime(r) > getTime(resolvedShift);
    } else {
      const isOffNew = !['出勤', '日勤', '特別出勤'].includes(r?.type || r?.shiftType);
      const isOffOld = !['出勤', '日勤', '特別出勤'].includes(resolvedShift?.type || resolvedShift?.shiftType);
      isBetter = isOffNew && !isOffOld;
    }

    if (isBetter) {
      resolvedShift = r;
    }
  }

  if (!resolvedShift) {
    return { hours: 0, rawType: '', resolvedShift: null };
  }

  const rawType = String(resolvedShift.type || resolvedShift.shiftType || '').trim();
  let addedHours = 0;

  // 1. 出勤・日勤・特別出勤・公休（週休）・休日出勤は勤務を要しない時間には加算しない (0h)
  if (['出勤', '日勤', '特別出勤', '公休', '休日出勤'].includes(rawType)) {
    addedHours = 0;
  }
  // 2. 年休 (通常: 7.75h, 会計年度: 7.5h)
  else if (['年休', '有給休暇', '有休', '年給', '有給'].includes(rawType)) {
    addedHours = fullDayHours;
  }
  // 3. 特休 (登録時間。終日の場合は 常勤: 7.75h / 会計年度: 7.5h)
  else if (rawType === '特休') {
    const rawH = resolvedShift.details?.specialHours ?? resolvedShift.specialHours ?? resolvedShift.details?.duration ?? resolvedShift.hours ?? resolvedShift.duration ?? resolvedShift.details?.hours;
    const parsedH = (rawH !== undefined && rawH !== null && rawH !== '') ? parseFloat(String(rawH)) : null;
    let h = fullDayHours;
    if (parsedH !== null && !isNaN(parsedH) && parsedH > 0 && parsedH < fullDayHours) {
      h = parsedH;
    }
    addedHours = h;
  }
  // 4. 時間休 (登録時間: カレンダー表示と完全一致するパース関数を使用)
  else if (['時間休', '時間給', '時間給2'].includes(rawType)) {
    const h = parseHourlyLeaveHours(resolvedShift);
    if (h > 0) {
      addedHours = h;
    }
  }
  // 5. 夏季休暇 (通常: 7.75h, 会計年度: 0h)
  else if (['夏季休暇', '夏期休暇', '夏休'].includes(rawType)) {
    if (!isFiscal) {
      addedHours = HOURS_PER_DAY; // 7.75h
    }
  }
  // 6. 振替4 (4.0h)
  else if (['振替4', '振4'].includes(rawType)) {
    addedHours = 4.0;
  }
  // 7. 振替＋時間休 (4.0h ＋ 登録された時間休の時間数)
  else if (rawType === '振替＋時間休') {
    const hrHours = Number(resolvedShift.details?.hourlyHours ?? resolvedShift.hourlyHours ?? (resolvedShift.hours && resolvedShift.hours > 4 ? resolvedShift.hours - 4 : 0));
    const validHr = (!isNaN(hrHours) && hrHours > 0) ? hrHours : 0;
    addedHours = 4.0 + validHr;
  }
  // 8. 特休＋時間休 (特休時間数 ＋ 時間休時間数)
  else if (rawType === '特休＋時間休') {
    const spHours = Number(resolvedShift.details?.specialHours ?? resolvedShift.specialHours ?? 0);
    const hrHours = Number(resolvedShift.details?.hourlyHours ?? resolvedShift.hourlyHours ?? 0);
    let h = 0;
    if (!isNaN(spHours) && !isNaN(hrHours) && (spHours > 0 || hrHours > 0)) {
      h = spHours + hrHours;
    } else if (resolvedShift.hours && !isNaN(Number(resolvedShift.hours)) && Number(resolvedShift.hours) > 0) {
      h = Number(resolvedShift.hours);
    } else {
      h = fullDayHours;
    }
    addedHours = h;
  }
  // 9. 平日の出張 (土日祝は除外。平日の出張のみ登録時間、終日は 常勤: 7.75h / 会計年度: 7.5h)
  else if (rawType === '出張') {
    if (dayType === 'weekday') {
      const rawH = resolvedShift.details?.duration ?? resolvedShift.hours ?? resolvedShift.duration ?? resolvedShift.details?.hours;
      const parsedH = (rawH !== undefined && rawH !== null && rawH !== '') ? parseFloat(String(rawH)) : null;
      let h = fullDayHours;
      if (parsedH !== null && !isNaN(parsedH) && parsedH > 0 && parsedH < fullDayHours) {
        h = parsedH;
      }
      addedHours = h;
    }
  }
  // 10. 午前休 / 午後休 (半休対応)
  else if (rawType === '午前休') {
    addedHours = 4.0;
  }
  else if (rawType === '午後休') {
    const h = isFiscal ? 3.5 : 3.75;
    addedHours = h;
  }

  return {
    hours: addedHours,
    rawType,
    resolvedShift,
  };
}

export interface WeekPeriod {
  weekIndex: number;
  startDate: Date;
  endDate: Date;
  startDateStr: string; // 'YYYY-MM-DD'
  endDateStr: string;   // 'YYYY-MM-DD'
  label: string;       // 例: '8/31(月) 〜 9/4(金)'
  days: string[];      // 平日5日間の 'YYYY-MM-DD' 配列 (月〜金)
}

/**
 * 選択された月において、その月に少なくとも1日以上の平日が含まれる週（月曜〜金曜の5日間）をすべて抽出します
 * 月またぎの週（例: 8/31(月)〜9/4(金)）も、1つの週（月〜金の5日間）として抽出します
 */
export function getWeekdayWeeksForMonth(year: number, month: number): WeekPeriod[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const mondayMap = new Map<string, Date>();

  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month - 1, d);
    const dow = curDate.getDay(); // 0: 日, 1: 月, 2: 火, 3: 水, 4: 木, 5: 金, 6: 土
    if (dow >= 1 && dow <= 5) {
      // 平日
      const offsetToMon = dow - 1; // 月曜日からの経過日数
      const monDate = new Date(year, month - 1, d - offsetToMon);
      const monKey = `${monDate.getFullYear()}-${String(monDate.getMonth() + 1).padStart(2, '0')}-${String(monDate.getDate()).padStart(2, '0')}`;
      if (!mondayMap.has(monKey)) {
        mondayMap.set(monKey, monDate);
      }
    }
  }

  const sortedMondayKeys = Array.from(mondayMap.keys()).sort();

  return sortedMondayKeys.map((monKey, idx) => {
    const monDate = mondayMap.get(monKey)!;
    const days: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monDate.getFullYear(), monDate.getMonth(), monDate.getDate() + i);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }

    const friDate = new Date(monDate.getFullYear(), monDate.getMonth(), monDate.getDate() + 4);
    const friKey = `${friDate.getFullYear()}-${String(friDate.getMonth() + 1).padStart(2, '0')}-${String(friDate.getDate()).padStart(2, '0')}`;

    const label = `${monDate.getMonth() + 1}/${monDate.getDate()}(月) 〜 ${friDate.getMonth() + 1}/${friDate.getDate()}(金)`;

    return {
      weekIndex: idx + 1,
      startDate: monDate,
      endDate: friDate,
      startDateStr: monKey,
      endDateStr: friKey,
      label,
      days,
    };
  });
}

export interface StaffWeeklyFloorItem {
  staffId: string;
  staffName: string;
  categoryName: string;
  placement: string;
  role: string;
  floor2Ratio: number;
  floor4Ratio: number;
  rawTotalHours: number;
  floor2Hours: number;
  floor4Hours: number;
  floor2HoursStr: string;
  floor4HoursStr: string;
  totalHoursStr: string;
  dayDetails: { date: string; hours: number; rawType: string }[];
}

export interface WeeklyFloorSummaryResult {
  weekIndex: number;
  label: string;
  startDateStr: string;
  endDateStr: string;
  days: string[];
  floor2Total: number;
  floor4Total: number;
  weekTotal: number;
  floor2TotalStr: string;
  floor4TotalStr: string;
  weekTotalStr: string;
  staffBreakdown: StaffWeeklyFloorItem[];
}

/**
 * 週別（平日5日間）フロア別（2Fスタッフ合計・4Fスタッフ合計）の「勤務を要しない時間」を集計します
 */
export function calculateWeeklyFloorNonWorkingHours(
  staffList: any[],
  allCalendarData: any[],
  year: number,
  month: number
): WeeklyFloorSummaryResult[] {
  if (!Array.isArray(staffList) || !Array.isArray(allCalendarData)) return [];

  const weeks = getWeekdayWeeksForMonth(year, month);

  const isInvalid = (r: any): boolean => {
    if (!r) return true;
    const st = String(r.status || '').trim().toLowerCase();
    const detailSt = String(r.details?.status || '').trim().toLowerCase();
    const invalidList = [
      'deleted', '削除',
      'rejected', '却下',
      'canceled', 'cancelled', 'キャンセル', '取り消し', '申請取消'
    ];
    return invalidList.includes(st) || invalidList.includes(detailSt);
  };

  const rejectedIds = new Set(
    allCalendarData.filter(isInvalid).map(r => String(r.id || '')).filter(Boolean)
  );

  // 対象スタッフと按分情報の判定（除外基準：事務、無効、入職前などを除外）
  const eligibleStaffWithAlloc = staffList
    .map(staff => {
      const alloc = getStaffFloorAllocation(staff);
      return { staff, alloc };
    })
    .filter(item => !item.alloc.isExcluded && (item.alloc.floor2Ratio > 0 || item.alloc.floor4Ratio > 0));

  return weeks.map(week => {
    let weekFloor2Total = 0;
    let weekFloor4Total = 0;
    const staffBreakdown: StaffWeeklyFloorItem[] = [];

    for (const { staff, alloc } of eligibleStaffWithAlloc) {
      let staffRawTotal = 0;
      const dayDetails: { date: string; hours: number; rawType: string }[] = [];

      for (const dayStr of week.days) {
        const { hours, rawType } = calculateStaffDailyNonWorkingHours(staff, allCalendarData, dayStr, rejectedIds);
        if (hours > 0) {
          staffRawTotal += hours;
          dayDetails.push({ date: dayStr, hours, rawType });
        }
      }

      if (staffRawTotal > 0) {
        const f2 = Math.round(staffRawTotal * alloc.floor2Ratio * 100) / 100;
        const f4 = Math.round(staffRawTotal * alloc.floor4Ratio * 100) / 100;
        weekFloor2Total += f2;
        weekFloor4Total += f4;

        staffBreakdown.push({
          staffId: String(staff.id || staff.email || staff.name),
          staffName: staff.name || '名称未設定',
          categoryName: alloc.categoryName,
          placement: staff.placement || staff.department || '-',
          role: staff.role || staff.position || '-',
          floor2Ratio: alloc.floor2Ratio,
          floor4Ratio: alloc.floor4Ratio,
          rawTotalHours: Math.round(staffRawTotal * 100) / 100,
          floor2Hours: f2,
          floor4Hours: f4,
          floor2HoursStr: formatNonWorkingHours(f2),
          floor4HoursStr: formatNonWorkingHours(f4),
          totalHoursStr: formatNonWorkingHours(staffRawTotal),
          dayDetails,
        });
      }
    }

    // スタッフの内訳を合計時間の多い順にソート
    staffBreakdown.sort((a, b) => b.rawTotalHours - a.rawTotalHours);

    const f2Rounded = Math.round(weekFloor2Total * 100) / 100;
    const f4Rounded = Math.round(weekFloor4Total * 100) / 100;
    const totalRounded = Math.round((f2Rounded + f4Rounded) * 100) / 100;

    return {
      weekIndex: week.weekIndex,
      label: week.label,
      startDateStr: week.startDateStr,
      endDateStr: week.endDateStr,
      days: week.days,
      floor2Total: f2Rounded,
      floor4Total: f4Rounded,
      weekTotal: totalRounded,
      floor2TotalStr: formatNonWorkingHours(f2Rounded),
      floor4TotalStr: formatNonWorkingHours(f4Rounded),
      weekTotalStr: formatNonWorkingHours(totalRounded),
      staffBreakdown,
    };
  });
}





