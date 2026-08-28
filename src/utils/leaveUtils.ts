/**
 * 年休計算ユーティリティ
 * 通常職員: 1日 = 7.75時間 (1/1起算)
 * 会計年度職員: 1日 = 7.50時間 (4/1起算)
 */

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
        const isOffNew = !['出勤', '日勤'].includes(r?.type);
        const isOffOld = !['出勤', '日勤'].includes(existing?.type);
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
        const isOffNew = !['出勤', '日勤'].includes(r?.type);
        const isOffOld = !['出勤', '日勤'].includes(existing?.type);
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
        const isOffNew = !['出勤', '日勤'].includes(r?.type);
        const isOffOld = !['出勤', '日勤'].includes(existing?.type);
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
    // ※特休、公休、振替休、看護休暇、夏季休暇、午前休、午後休等は除外
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



