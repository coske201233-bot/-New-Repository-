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

  return requests.reduce((sum, r) => {
    if (!r || r.status === 'rejected') return sum;
    
    // 1. UUID マッチング (最優先)
    const rId = r.staffId || r.staff_id || r.userId || r.user_id;
    let isMatch = false;

    if (targetId && rId && String(targetId) === String(rId)) {
      isMatch = true;
    } else if (targetName) {
      // 2. 名前による補助フォールバック
      const rStaff = normalize(r.staffName || r.staff_name || r.name || '');
      if (rStaff && (rStaff === targetName || rStaff.includes(targetName) || targetName.includes(rStaff))) {
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
