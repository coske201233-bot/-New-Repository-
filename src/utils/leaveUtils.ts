/**
 * 年休計算ユーティリティ (ステップ 1: 独立計算エンジン)
 * 通常職員: 1日 = 7.75時間
 * 会計年度職員: 1日 = 7.5時間
 */

export const HOURS_PER_DAY = 7.75;
export const FISCAL_YEAR_HOURS_PER_DAY = 7.5;

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
  const hours = absHours % rate;
  
  const formattedStr = `${days}日${hours.toFixed(2)}時間`;
  return isNegative ? `-${formattedStr}` : formattedStr;
};

const normalize = (name?: string) => (name || '').replace(/[\s\u3000]/g, '').trim();

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
 * 承認された申請リストから消化年休時間数を計算します (UUID優先)
 */
export const calculateUsedLeaveHours = (
  requests: any[], 
  staffOrId?: any, 
  position?: string
): number => {
  if (!Array.isArray(requests) || !staffOrId) return 0;

  const targetId = typeof staffOrId === 'string' ? staffOrId : (staffOrId?.id || staffOrId?.userId || staffOrId?.user_id);
  const targetName = typeof staffOrId === 'object' ? normalize(staffOrId?.name) : normalize(staffOrId);
  const pos = typeof staffOrId === 'object' ? (staffOrId?.position || staffOrId?.role || position) : position;
  const hoursPerDay = getLeaveHoursPerDay(pos);
  const isFiscalYear = pos ? pos.includes('会計年度') : false;

  return requests.reduce((sum, r) => {
    if (!r || r.status === 'rejected') return sum;
    
    // 起算期間判定（通常職員: 1/1〜, 会計年度職員: 4/1〜）
    if (!isLeaveDateInFiscalPeriod(r.date, isFiscalYear)) {
      return sum;
    }

    // 1. UUID マッチング (最優先)
    const rId = r.staffId || r.staff_id || r.userId || r.user_id;
    let isMatch = false;

    if (targetId && rId && String(targetId) === String(rId)) {
      isMatch = true;
    } else if (targetName) {
      // 2. 名前による補助フォールバック (完全一致のみ)
      const rStaff = normalize(r.staffName || r.staff_name || r.name || '');
      if (rStaff && rStaff === targetName) {
        isMatch = true;
      }
    }

    if (!isMatch) return sum;
    
    // 申請タイプごとの消化時間の算出
    const type = (r.type || r.shiftType || '').trim();
    if (type === '年休' || type === '有給休暇' || type === '有休' || type === '年給') {
      return sum + hoursPerDay;
    } else if (type === '時間休' || type === '時間給') {
      const h = Number(r.hours || r.duration || r.details?.duration || 1);
      return sum + (isNaN(h) ? 0 : h);
    } else if (type === '特休＋時間休') {
      const h = Number(r.details?.hourlyHours || r.hourlyHours || 0);
      return sum + (isNaN(h) ? 0 : h);
    } else if (type === '午前休') {
      return sum + (hoursPerDay === 7.5 ? 4.0 : 4.0);
    } else if (type === '午後休') {
      return sum + (hoursPerDay === 7.5 ? 3.5 : 3.75);
    }
    
    return sum;
  }, 0);
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
  achievedDays: number;   // 取得済み日数（0.5日単位）
  neededDays: number;     // 残り必要な日数（0.5日単位）
  isCompleted: boolean;   // 5日達成済みか
  displayText: string;    // 個人カード用表示テキスト
}

/**
 * 職員の役職・区分から午後休（半日休）の時間数を決定
 */
const getAfternoonHours = (position?: string, role?: string): number => {
  const target = `${position || ''} ${role || ''}`;
  return target.includes('会計年度') ? 3.5 : 3.75;
};

/**
 * 年休5日必修化のカウント＆判定メイン関数
 */
export const calculateMandatoryLeaveStatus = (
  staff: { id?: string; name?: string; position?: string; role?: string },
  requests: any[],
  referenceYear: number = new Date().getFullYear()
): MandatoryLeaveStatus => {
  const targetId = staff.id;
  const targetName = (staff.name || '').replace(/[\s\u3000]/g, '').trim();
  const afternoonHours = getAfternoonHours(staff.position, staff.role);

  // 12月末までの対象年度データのみ抽出
  const targetRequests = (requests || []).filter(r => {
    if (!r || r.status === 'rejected' || r.status === 'deleted') return false;

    const dateStr = (r.date || '').split('T')[0];
    if (!dateStr) return false;
    const d = new Date(dateStr.replace(/-/g, '/'));
    if (d.getFullYear() !== referenceYear) return false;

    const rId = r.staffId || r.staff_id || r.userId || r.user_id;
    if (targetId && rId && String(targetId) === String(rId)) return true;

    const rName = (r.staffName || r.staff_name || r.name || '').replace(/[\s\u3000]/g, '').trim();
    return rName !== '' && rName === targetName;
  });

  let fullDaysCount = 0; // 1日休 (1.0)
  let halfDaysCount = 0; // 対象となる半日休 (0.5)

  targetRequests.forEach(r => {
    const type = (r.type || r.shiftType || '').trim();
    const hours = Number(r.hours || r.duration || r.details?.duration || 0);

    // 【1】1日休 (1.0日分) ※振休などを除外し純粋な年休のみに絞り込み
    if (['年休', '有給休暇', '年給', '有休'].includes(type)) {
      fullDaysCount += 1.0;
    }
    // 【2】4時間休（午前） / 午前休 (0.5日分)
    else if (type === '午前休' || (type === '時間休' && hours === 4.0)) {
      halfDaysCount += 1.0;
    }
    // 【3】3.75h(3.5h)休 / 午後休 (0.5日分)
    else if (type === '午後休' || (type === '時間休' && hours === afternoonHours)) {
      halfDaysCount += 1.0;
    }
    // ※その他の端数（1時間休、2時間休、4.5時間休など）は一切カウントしない
  });

  // 取得済日数の算定（半日休は2回で1日、1回で0.5日として累積）
  const achievedDays = fullDaysCount + (halfDaysCount * 0.5);

  // 残り必要日数の計算（目標5日）
  const neededDays = Math.max(0, 5.0 - achievedDays);
  const isCompleted = neededDays <= 0;

  // カード表示用テキストの生成
  let displayText = '';
  if (isCompleted) {
    displayText = '年休5日取得済み';
  } else {
    // 0.5日単位の表記（例: 要年休4.5日、要年休4日）
    displayText = `要年休${neededDays}日`;
  }

  return {
    achievedDays,
    neededDays,
    isCompleted,
    displayText
  };
};

