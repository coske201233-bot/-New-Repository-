import { supabase } from './supabase';
import { getDateStr, getDayType, normalizeName } from './dateUtils';

/**
 * 休日ローテーション順序 (18名)
 */
export const HOLIDAY_ROTATION_ORDER = [
  '吉田', '佐藤公貴', '佐藤', '三井', '阿部', '藤森', '坂下', '佐久間', '中野',
  '山川', '久保田', '小笠原', '森田', '駒津', '馬淵', '大沼', '辻', '南條'
];

export interface ShiftTargetLimits {
  weekdayCap: number;
  satCap: number;
  sunCap: number;
  holidayCap: number;
}

interface StaffTracker {
  id: string;
  name: string;
  totalWorkCount: number;
  holidayWorkCount: number;
  workedDates: Set<string>;
  isWeekendOff: boolean;
  forcedOffDates: Set<string>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const generateValidUuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const ensureValidUuid = (val: any): string => {
  const str = String(val ?? '').trim();
  if (UUID_REGEX.test(str)) return str;
  return generateValidUuid();
};

const extractUuid = (id: string) => {
  if (!id) return '';
  const parts = id.split('-');
  // auto-UUID-DATE-... または m-UUID-DATE-... 形式 (1 + 5 + ...)
  if (parts.length >= 6) return parts.slice(1, 6).join('-');
  // それ以外（req-TIMESTAMP など）はそのまま、または末尾5要素（レガシー対応）
  if (parts.length >= 5) return parts.slice(-5).join('-');
  return id;
};

const isInvalidStatus = (status: any): boolean =>
  ['pending', '申請中', 'rejected', '却下', 'deleted', '削除', 'superseded'].includes(String(status || '').trim());

const isApprovedRecord = (rec: any): boolean => {
  if (!rec || isInvalidStatus(rec.status)) return false;
  return (
    rec.status === 'approved' ||
    rec.status === '承認' ||
    rec.is_manual === true ||
    rec.isManual === true ||
    rec.details?.isManual === true
  );
};

const isManualRecord = (rec: any): boolean => {
  if (!rec) return false;
  if (rec.is_manual === true || rec.isManual === true || rec.details?.isManual === true) return true;
  if (rec.is_manual === false || rec.isManual === false || rec.details?.isManual === false || rec.details?.isAuto === true) return false;
  const idStr = String(rec.id || '');
  return idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('req-');
};

const isOffShiftType = (type: any): boolean =>
  ['公休', '年休', '有給休暇', '夏季休暇', '特休', '休暇', '欠勤', '研修', '出張', '振替', '振休', '全休', '年給', '有給'].includes(
    String(type || '').trim()
  );

const isWorkShiftType = (type: any): boolean =>
  ['出勤', '日勤', '休日出勤', '特別出勤', 'カスタム'].includes(String(type || '').trim());

const getRecordTimestamp = (rec: any): number => {
  const t = rec?.updatedAt || rec?.details?.updatedAt || rec?.updated_at || rec?.createdAt || rec?.created_at || 0;
  return typeof t === 'string' ? new Date(t).getTime() : typeof t === 'number' ? t : 0;
};

/**
 * 与えられた出勤日集合における最大連勤数と6連勤以上の違反ペナルティを計算
 */
const evaluateStreaks = (datesSet: Set<string>): { maxLen: number; violationPenalty: number } => {
  const sorted = Array.from(datesSet).sort();
  let maxLen = 0;
  let violationPenalty = 0;
  let currentLen = 0;
  let prevDate: Date | null = null;

  for (const dStr of sorted) {
    const curr = new Date(dStr.replace(/-/g, '/'));
    if (!prevDate) {
      currentLen = 1;
    } else {
      const diff = Math.round((curr.getTime() - prevDate.getTime()) / (1000 * 3600 * 24));
      if (diff === 1) {
        currentLen++;
      } else {
        if (currentLen > maxLen) maxLen = currentLen;
        if (currentLen >= 6) violationPenalty += (currentLen - 5) * 10 + 100;
        currentLen = 1;
      }
    }
    prevDate = curr;
  }
  if (currentLen > maxLen) maxLen = currentLen;
  if (currentLen >= 6) violationPenalty += (currentLen - 5) * 10 + 100;

  return { maxLen, violationPenalty };
};

const wouldViolateStreak = (dateStr: string, workedDates: Set<string>): boolean => {
  const d = new Date(dateStr.replace(/-/g, '/'));
  let forwardStreak = 0;
  for (let i = 1; i <= 5; i++) {
    const prev = new Date(d);
    prev.setDate(d.getDate() - i);
    if (workedDates.has(getDateStr(prev))) forwardStreak++;
    else break;
  }
  if (forwardStreak >= 5) return true;
  let backwardStreak = 0;
  for (let i = 1; i <= 5; i++) {
    const next = new Date(d);
    next.setDate(d.getDate() + i);
    if (workedDates.has(getDateStr(next))) backwardStreak++;
    else break;
  }
  if (backwardStreak >= 5) return true;
  if (forwardStreak + backwardStreak + 1 > 5) return true;
  return false;
};

export const generateMonthlyShifts = async (
  year: number,
  month: number,
  limits: ShiftTargetLimits
) => {
  const jsMonth = month - 1;
  const lastDay = new Date(year, jsMonth + 1, 0).getDate();
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  console.log('══════════════════════════════════════════════');
  console.log(`[BUILD: VERSION 77.0 - STRICT CARRYOVER & ZERO 6-STREAK] 処理開始: ${year}年${month}月`);
  console.log('══════════════════════════════════════════════');

  try {
    // Step 0: 自動生成シフトを削除（is_manual = false を対象）
    const { error: deleteError } = await supabase
      .from('shifts')
      .delete()
      .eq('is_manual', false)
      .gte('date', startDate)
      .lte('date', endDateStr);

    if (deleteError) {
      console.error('[ShiftEngine] 自動シフトの削除に失敗 (is_manual filter):', deleteError.message);
    }

    // Step A: スタッフ取得 (rotation_order順で取得、未設定は後回し)
    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('*')
      .order('rotation_order', { ascending: true, nullsFirst: false });
    if (staffError) throw staffError;

    const eligibleForFilter = (staffData || []).filter(staff => {
      const status = (staff.status || '').trim();
      const placement = (staff.placement || '').trim();
      const profession = (staff.profession || staff.jobType || '').trim();
      const role = (staff.role || '').trim();
      const start = (staff.leave_start_date || staff.leaveStartDate || '').slice(0, 7).trim();
      const end = (staff.leave_end_date || staff.leaveEndDate || '').slice(0, 7).trim();
      const isLeavePeriod = (start && end) ? (start <= monthPrefix && monthPrefix <= end) : start ? (start <= monthPrefix) : end ? (monthPrefix <= end) : true;
      if (status.includes('長期休暇') && isLeavePeriod) return false;
      if (placement.includes('訪問リハ')) return false;
      if (profession.includes('助手')) return false;
      if (placement.includes('助手')) return false;
      if (role.includes('助手')) return false;
      return true;
    });

    // Step 0.2: 前月（直近40日間）の shifts と requests を両方取得し、各日・各スタッフの「最終有効シフト」を確定させる
    // これにより、手動で公休に変更された古い自動出勤レコード（SA等）がローテーション引継ぎや連勤判定に混入するのを完全に防ぐ
    const searchStartDate = new Date(year, jsMonth, -40);
    const searchEndDate = new Date(year, jsMonth, 0);

    const [{ data: recentShiftsRaw, error: rShiftErr }, { data: recentRequestsRaw, error: rReqErr }] = await Promise.all([
      supabase
        .from('shifts')
        .select('*')
        .gte('date', getDateStr(searchStartDate))
        .lte('date', getDateStr(searchEndDate))
        .limit(10000),
      supabase
        .from('requests')
        .select('*')
        .gte('date', getDateStr(searchStartDate))
        .lte('date', getDateStr(searchEndDate))
        .limit(10000),
    ]);
    if (rShiftErr) console.warn('[ShiftEngine] 前月shifts取得警告:', rShiftErr.message);
    if (rReqErr) console.warn('[ShiftEngine] 前月requests取得警告:', rReqErr.message);

    const invalidPrevIds = new Set<string>();
    [...(recentRequestsRaw || []), ...(recentShiftsRaw || [])].forEach((r: any) => {
      if (r && r.id && isInvalidStatus(r.status)) {
        invalidPrevIds.add(String(r.id));
      }
    });

    // dateStr -> Map<staffId, winningRecord>
    const prevEffectiveByDate = new Map<string, Map<string, any>>();
    [...(recentRequestsRaw || []), ...(recentShiftsRaw || [])].forEach((r: any) => {
      if (!r || !r.date || !isApprovedRecord(r) || invalidPrevIds.has(String(r.id))) return;
      const dStr = String(r.date).substring(0, 10);
      const rawId = String(r.staff_id || r.staffId || r.user_id || r.userId || extractUuid(r.id) || '').trim();
      const rawName = normalizeName(r.staff_name || r.staffName || r.details?.staffName || '');
      const matchedStaff = (staffData || []).find((s: any) =>
        (rawId && (s.id === rawId || s.user_id === rawId)) ||
        (rawName && normalizeName(s.name) === rawName)
      );
      const staffId = matchedStaff?.id || rawId;
      if (!staffId) return;

      if (!prevEffectiveByDate.has(dStr)) prevEffectiveByDate.set(dStr, new Map<string, any>());
      const dayMap = prevEffectiveByDate.get(dStr)!;
      const existing = dayMap.get(staffId);
      const normalizedRec = {
        ...r,
        staff_id: staffId,
        staff_name: matchedStaff?.name || r.staff_name || r.staffName || '',
      };

      if (!existing) {
        dayMap.set(staffId, normalizedRec);
      } else {
        const manNew = isManualRecord(normalizedRec);
        const manOld = isManualRecord(existing);
        let takeNew = false;
        if (manNew && !manOld) {
          takeNew = true;
        } else if (!manNew && manOld) {
          takeNew = false;
        } else {
          const tDiff = getRecordTimestamp(normalizedRec) - getRecordTimestamp(existing);
          if (tDiff !== 0) {
            takeNew = tDiff > 0;
          } else {
            takeNew = isOffShiftType(normalizedRec.type) && !isOffShiftType(existing.type);
          }
        }
        if (takeNew) {
          dayMap.set(staffId, normalizedRec);
        }
      }
    });

    // Step 0.5: 現月シフト・申請をロード
    const { data: currentShifts } = await supabase
      .from('shifts').select('*').gte('date', startDate).lte('date', endDateStr);

    const { data: currentRequests } = await supabase
      .from('requests').select('*').gte('date', startDate).lte('date', endDateStr).eq('status', 'approved');

    const manualDayMap = new Map<string, any>();
    (currentShifts || []).forEach(s => {
      if (isInvalidStatus(s.status)) return;
      const isManualFlag = isManualRecord(s);
      if (isManualFlag) {
        const dKey = s.date.substring(0, 10);
        const sId = String(s.staff_id || s.staffId || s.user_id || s.userId || extractUuid(s.id) || '').trim();
        if (sId) manualDayMap.set(`${dKey}_${sId}`, s);
      }
    });
    (currentRequests || []).forEach(r => {
      if (isInvalidStatus(r.status)) return;
      const dKey = r.date.substring(0, 10);
      const sId = String(r.staff_id || r.staffId || r.user_id || r.userId || extractUuid(r.id) || '').trim();
      const sName = normalizeName(r.staff_name || r.staffName || '');
      if (sId) manualDayMap.set(`${dKey}_${sId}`, r);
      if (sName) manualDayMap.set(`${dKey}_name_${sName}`, r);
    });
    const manualShifts = Array.from(manualDayMap.values());

    // Step B: 承認済み休暇申請
    const { data: approvedLeaves } = await supabase
      .from('requests')
      .select('staff_name, user_id, staff_id, date, type, status')
      .like('date', `${monthPrefix}%`)
      .eq('status', 'approved')
      .not('type', 'in', '("出勤")');

    const leaveSet = new Set<string>();
    (approvedLeaves || []).forEach((r: any) => {
      const uid = r.staff_id || r.staffId || r.user_id || r.userId || extractUuid(r.id);
      if (uid && r.date) leaveSet.add(`uid__${uid}__${r.date}`);
    });

    const hasLeave = (tracker: StaffTracker, dateStr: string): boolean => {
      return leaveSet.has(`uid__${tracker.id}__${dateStr}`);
    };

    // Step C: 月の全日程を分類
    const holidayDates: { dateStr: string; dayType: string; cap: number }[] = [];
    const weekdayDates: string[] = [];

    for (let i = 1; i <= lastDay; i++) {
      const d = new Date(year, jsMonth, i);
      const dateStr = getDateStr(d);
      const dayType = getDayType(d);
      if (dayType === 'weekday') {
        weekdayDates.push(dateStr);
      } else {
        let cap = limits.holidayCap;
        if (dayType === 'sat') cap = limits.satCap;
        else if (dayType === 'sun') cap = limits.sunCap;
        holidayDates.push({ dateStr, dayType, cap });
      }
    }

    // Step D: スタッフトラッカー初期化（前月末の実績を連結）
    const trackers = new Map<string, StaffTracker>();
    const manualWorkCountPerDay = new Map<string, number>();
    const hasPrevMonthSchedule = prevEffectiveByDate.size > 0;
    const prevStreakStart = new Date(year, jsMonth, -10);
    const prevStreakEnd = new Date(year, jsMonth, 0);

    eligibleForFilter.forEach(staff => {
      const isWeekendOff = !!(staff.no_holiday === true || staff.no_holiday === 'true' || staff.noHoliday === true);
      const tracker: StaffTracker = {
        id: staff.id,
        name: staff.name,
        totalWorkCount: 0,
        holidayWorkCount: 0,
        workedDates: new Set<string>(),
        isWeekendOff,
        forcedOffDates: new Set<string>(),
      };
      (manualShifts || []).forEach((ms: any) => {
        const msId = String(ms.staff_id || ms.staffId || ms.user_id || ms.userId || extractUuid(ms.id) || '').trim();
        if (msId && msId === staff.id) {
          const dKey = ms.date.substring(0, 10);
          if (isWorkShiftType(ms.type)) {
            tracker.workedDates.add(dKey);
            tracker.totalWorkCount++;
            if (getDayType(new Date(ms.date.replace(/-/g, '/'))) !== 'weekday') tracker.holidayWorkCount++;
            manualWorkCountPerDay.set(dKey, (manualWorkCountPerDay.get(dKey) || 0) + 1);
          } else if (isOffShiftType(ms.type)) {
            tracker.forcedOffDates.add(dKey);
          }
        }
      });

      // 前月末（直近10日間）の確定済み勤務実績を連結（月跨ぎの6連勤を確実に防止）
      if (hasPrevMonthSchedule) {
        const pStart = (staff.leave_start_date || staff.leaveStartDate || '').slice(0, 10).trim();
        const pEnd = (staff.leave_end_date || staff.leaveEndDate || '').slice(0, 10).trim();
        for (let dt = new Date(prevStreakStart.getTime()); dt <= prevStreakEnd; dt.setDate(dt.getDate() + 1)) {
          const dStr = getDateStr(dt);
          const isStaffLeaveOnDay = (staff.status || '').includes('長期休暇') && (
            (pStart && pEnd) ? (pStart <= dStr && dStr <= pEnd) : pStart ? (pStart <= dStr) : pEnd ? (dStr <= pEnd) : true
          );
          if (isStaffLeaveOnDay) continue;

          const dayMap = prevEffectiveByDate.get(dStr);
          const eff = dayMap ? dayMap.get(staff.id) : null;
          const dType = getDayType(dt);
          if (eff) {
            if (!isOffShiftType(eff.type)) {
              tracker.workedDates.add(dStr);
            }
          } else if (dType === 'weekday') {
            // カレンダー仕様と同じく、前月の平日で休みレコードがない場合は出勤扱い
            tracker.workedDates.add(dStr);
          }
        }
      }

      trackers.set(staff.id, tracker);
    });

    const hasManualShift = (staffId: string, dateStr: string): boolean => {
      return (manualShifts || []).some((ms: any) => {
        const msId = String(ms.staff_id || ms.staffId || ms.user_id || ms.userId || extractUuid(ms.id) || '').trim();
        return (msId && msId === staffId && ms.date.substring(0, 10) === dateStr);
      });
    };

    const generatedShifts: any[] = [];

    const assignOffShift = (tracker: StaffTracker, dateStr: string, type: string, phase: string) => {
      const newId = generateValidUuid();
      generatedShifts.push({
        id: newId,
        staff_name: tracker.name, staff_id: tracker.id, date: dateStr, type,
        status: 'approved',
        is_manual: false,
        details: { isManual: false, phase, note: `V77.0 ${phase}`, isAuto: true }
      });
      tracker.forcedOffDates.add(dateStr);
    };

    const assignShift = (tracker: StaffTracker, dateStr: string, dayType: string, phase: string) => {
      const newId = generateValidUuid();
      generatedShifts.push({
        id: newId,
        staff_name: tracker.name, staff_id: tracker.id, date: dateStr, type: '出勤',
        status: 'approved',
        is_manual: false,
        details: { isManual: false, phase, dayType, isHolidayWork: dayType !== 'weekday', note: `V77.0 ${phase}`, isAuto: true }
      });
      tracker.totalWorkCount++;
      tracker.workedDates.add(dateStr);
      if (dayType !== 'weekday') {
        tracker.holidayWorkCount++;
        findAndSetCompOff(tracker, dateStr, weekdayDates, generatedShifts);
      }
    };

    /**
     * 休日出勤に対する振休（公休）配置ロジック
     * - 土曜・祝日出勤は「同週の平日（月〜金）」、日曜出勤は「翌週の平日（月〜金）」を第一候補とし、
     *   前月末〜当月全体の出勤予定をシミュレーションして「その振休を置かないと6連勤以上になる日」を最優先で選択する。
     */
    function findAndSetCompOff(tracker: StaffTracker, holidayDateStr: string, weekdays: string[], currentGenerated: any[]) {
      const hDate = new Date(holidayDateStr.replace(/-/g, '/'));
      const dayOfWeek = hDate.getDay(); // 0=日曜, 6=土曜, 1..5=祝日

      const getMondayBefore = (d: Date) => {
        const date = new Date(d.getTime());
        const day = date.getDay();
        date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
        return date;
      };

      const mondayBefore = getMondayBefore(hDate);
      const mondayAfter = new Date(mondayBefore.getTime());
      mondayAfter.setDate(mondayBefore.getDate() + 7);

      // 日曜出勤の場合、前日の土曜は休みであり「日曜＋翌週月〜金＝6連勤」となるため、翌週の月〜金を第一候補にする
      // 土曜・平日祝日の場合は、同週の月〜金を第一候補にする
      const primaryMonday = dayOfWeek === 0 ? mondayAfter : mondayBefore;
      const secondaryMonday = dayOfWeek === 0 ? mondayBefore : mondayAfter;

      const getAvailableInWeek = (monDate: Date): string[] => {
        const list: string[] = [];
        for (let i = 0; i < 5; i++) {
          const d = new Date(monDate.getTime());
          d.setDate(monDate.getDate() + i);
          const dStr = getDateStr(d);
          if (
            weekdays.includes(dStr) &&
            !tracker.workedDates.has(dStr) &&
            !tracker.forcedOffDates.has(dStr) &&
            !hasLeave(tracker, dStr) &&
            !hasManualShift(tracker.id, dStr)
          ) {
            list.push(dStr);
          }
        }
        return list;
      };

      const primaryCandidates = getAvailableInWeek(primaryMonday);
      const secondaryCandidates = getAvailableInWeek(secondaryMonday);
      let candidates = Array.from(new Set([...primaryCandidates, ...secondaryCandidates]));

      // 万が一前後週に空きがない場合は月内の全利用可能平日から探索
      if (candidates.length === 0) {
        candidates = weekdays.filter(
          dStr =>
            !tracker.workedDates.has(dStr) &&
            !tracker.forcedOffDates.has(dStr) &&
            !hasLeave(tracker, dStr) &&
            !hasManualShift(tracker.id, dStr)
        );
      }

      if (candidates.length === 0) {
        console.warn(`[ShiftEngine] ${tracker.name}: 振休を割り当てられませんでした(${holidayDateStr})`);
        return;
      }

      // 候補日 candDate に振休（公休）を配置した場合の月全体（前月末含む）の連続勤務をシミュレーション評価
      const evaluateCandidate = (candDate: string) => {
        const simWorked = new Set<string>(tracker.workedDates);
        for (const wDate of weekdays) {
          if (wDate === candDate) continue;
          if (tracker.forcedOffDates.has(wDate)) continue;
          if (hasLeave(tracker, wDate)) continue;
          if (hasManualShift(tracker.id, wDate)) continue;
          simWorked.add(wDate);
        }
        const { maxLen, violationPenalty } = evaluateStreaks(simWorked);
        const isPrimary = primaryCandidates.includes(candDate) ? 0 : 1;
        const compOffCountOnDay = currentGenerated.filter(
          s => s.date === candDate && s.details?.phase === 'holiday_comp_off'
        ).length;
        return { violationPenalty, isPrimary, compOffCountOnDay, maxLen };
      };

      const sorted = candidates.sort((a, b) => {
        const evalA = evaluateCandidate(a);
        const evalB = evaluateCandidate(b);
        // 1. 6連勤以上が発生しない候補を最優先（violationPenalty が最小）
        if (evalA.violationPenalty !== evalB.violationPenalty) {
          return evalA.violationPenalty - evalB.violationPenalty;
        }
        // 2. 第一候補週（土曜・祝日は同週、日曜は翌週）を優先
        if (evalA.isPrimary !== evalB.isPrimary) {
          return evalA.isPrimary - evalB.isPrimary;
        }
        // 3. 同じ日に振休が集中しないよう平準化
        if (evalA.compOffCountOnDay !== evalB.compOffCountOnDay) {
          return evalA.compOffCountOnDay - evalB.compOffCountOnDay;
        }
        // 4. 最大連勤数がより短くなる日を優先
        return evalA.maxLen - evalB.maxLen;
      });

      assignOffShift(tracker, sorted[0], '公休', 'holiday_comp_off');
    }

    // ═══════════════════════════════════════════
    // Pass 1 & 2: HOLIDAY ASSIGNMENTS & COMP-OFFS
    // ═══════════════════════════════════════════
    console.log('--- STARTING HOLIDAY ASSIGNMENTS ---');

    if (!holidayDates || holidayDates.length === 0) {
      console.error('CRITICAL ERROR: holidayDates is empty!');
    } else {
      // ローテーション参加者のみの純粋なリストを構築（土日祝休みのスタッフは除外）
      const sortedStaffList = eligibleForFilter
        .filter(
          s =>
            s.rotation_order !== null &&
            s.rotation_order !== undefined &&
            s.rotation_order !== '' &&
            s.no_holiday !== true &&
            s.no_holiday !== 'true' &&
            s.noHoliday !== true
        )
        .sort((a, b) => {
          const orderA = parseInt(String(a.rotation_order), 10) || 999;
          const orderB = parseInt(String(b.rotation_order), 10) || 999;
          return orderA - orderB;
        });

      console.log(
        `[ShiftEngine] Rotation List (${sortedStaffList.length}名):`,
        sortedStaffList.map((s, i) => `${i}:${s.name}(RO:${s.rotation_order})`).join(', ')
      );

      let currentStaffIndex = 0;

      try {
        // 前月（直近40日間）の最終有効シフト（prevEffectiveByDate）から、最後に休日出勤が行われた日を逆順探索
        const prevDatesDesc = Array.from(prevEffectiveByDate.keys()).sort((a, b) => b.localeCompare(a));
        let foundCarryOver = false;

        for (const dStr of prevDatesDesc) {
          const d = new Date(dStr.replace(/-/g, '/'));
          if (getDayType(d) === 'weekday') continue;

          const dayMap = prevEffectiveByDate.get(dStr)!;
          // 削除・却下・公休上書き済みのレコードは prevEffectiveByDate 構築時点で除外・解決済み
          const activeHolidayWorkers = Array.from(dayMap.values()).filter(rec => isWorkShiftType(rec.type));

          const indicesOnLastDay = activeHolidayWorkers
            .map((row: any) => {
              const staffId = row.staff_id || row.staffId;
              const staffName = normalizeName(row.staff_name || row.staffName || '');
              let idx = -1;
              if (staffId) {
                idx = sortedStaffList.findIndex((s: any) => s.id === staffId);
              }
              if (idx === -1 && staffName) {
                idx = sortedStaffList.findIndex((s: any) => normalizeName(s.name) === staffName);
              }
              return idx;
            })
            .filter(idx => idx !== -1);

          if (indicesOnLastDay.length > 0) {
            const minIdx = Math.min(...indicesOnLastDay);
            const maxIdx = Math.max(...indicesOnLastDay);
            let tailIndex = -1;

            // 配列の末尾から先頭への折り返し（ラップアラウンド、例: [12, 0]）を検知
            if (maxIdx - minIdx > sortedStaffList.length / 2) {
              const smallIndices = indicesOnLastDay.filter(i => i < sortedStaffList.length / 2);
              tailIndex = smallIndices.length > 0 ? Math.max(...smallIndices) : maxIdx;
            } else {
              tailIndex = maxIdx;
            }

            currentStaffIndex = (tailIndex + 1) % sortedStaffList.length;
            console.log(
              `[CarryOver] SUCCESS: LastHoliday=${dStr}, ActiveWorkers=${activeHolidayWorkers
                .map((s: any) => s.staff_name)
                .join('/')}, Indices=[${indicesOnLastDay.join(', ')}], Tail=${tailIndex}(${
                sortedStaffList[tailIndex]?.name
              }) -> Next=${currentStaffIndex}(${sortedStaffList[currentStaffIndex]?.name})`
            );
            foundCarryOver = true;
            break;
          }
        }

        if (!foundCarryOver) {
          console.warn('[ShiftEngine] 前月の有効な休日出勤シフトが見つかりません。先頭(0)から開始します。');
          currentStaffIndex = 0;
        }
      } catch (e) {
        console.error('[ShiftEngine] 引継ぎ計算エラー:', e);
        currentStaffIndex = 0;
      }

      // Pass 1: 当月の全休日出勤をローテーション順に割り当て
      const assignedHolidayEvents: { tracker: StaffTracker; dateStr: string }[] = [];

      for (const { dateStr, dayType, cap } of holidayDates) {
        let assignedCountForDay = 0;
        let loopFailsafe = 0;

        while (assignedCountForDay < cap && loopFailsafe < sortedStaffList.length * 2) {
          const person = sortedStaffList[currentStaffIndex % sortedStaffList.length];
          const tracker = trackers.get(person.id)!;

          if (!tracker.workedDates.has(dateStr) && !tracker.forcedOffDates.has(dateStr) && !hasLeave(tracker, dateStr)) {
            generatedShifts.push({
              id: generateValidUuid(),
              staff_name: tracker.name,
              staff_id: tracker.id,
              date: dateStr,
              type: '出勤',
              status: 'approved',
              is_manual: false,
              details: {
                isManual: false,
                phase: 'holiday_strict_sequence',
                dayType,
                isHolidayWork: true,
                staffName: tracker.name,
                note: 'V77.0 Strict CarryOver',
                isAuto: true,
              },
            });
            tracker.totalWorkCount++;
            tracker.workedDates.add(dateStr);
            tracker.holidayWorkCount++;
            assignedHolidayEvents.push({ tracker, dateStr });
            assignedCountForDay++;
            loopFailsafe = 0;
          } else {
            loopFailsafe++;
          }
          currentStaffIndex = (currentStaffIndex + 1) % sortedStaffList.length;
        }

        if (loopFailsafe >= sortedStaffList.length * 2) {
          console.warn(`[WARNING] ${dateStr}: ${assignedCountForDay}/${cap}人のみ割り当て完了`);
        }
      }

      // Pass 2: 当月の全休日出勤日が確定した状態で、6連勤を確実に防止する平日へ振休（公休）を配置
      for (const { tracker, dateStr } of assignedHolidayEvents) {
        findAndSetCompOff(tracker, dateStr, weekdayDates, generatedShifts);
      }
    }
    console.log('--- FINISHED HOLIDAY ASSIGNMENTS ---');

    // Pass 3: 平日割り当て（6連勤になる場合は明示的に公休を配置し、カレンダーのデフォルト出勤化による6連勤を防止）
    console.log('\n[ShiftEngine] ════ Pass 3: 平日割り当て ════');
    for (const dateStr of weekdayDates) {
      let assignedCount = 0;
      const staffArray = Array.from(trackers.values());
      for (const t of staffArray) {
        if (t.workedDates.has(dateStr)) continue;
        if (hasLeave(t, dateStr)) continue;
        if (t.forcedOffDates.has(dateStr)) continue;
        if (hasManualShift(t.id, dateStr)) continue;

        if (wouldViolateStreak(dateStr, t.workedDates)) {
          assignOffShift(t, dateStr, '公休', 'streak_break_fix');
        } else {
          assignShift(t, dateStr, 'weekday', 'weekday_equalization');
          assignedCount++;
        }
      }
      const manualCount = manualWorkCountPerDay.get(dateStr) || 0;
      console.log(`[ShiftEngine] ${dateStr}(weekday): ${assignedCount}人 合計${manualCount + assignedCount}`);
    }

    // Pass 4: 最終連勤チェック（万が一6連勤以上が残っている場合は当月の自動平日出勤を公休へ置換）
    console.log('\n[ShiftEngine] ════ Pass 4: 連勤チェック ════');
    trackers.forEach(tracker => {
      for (let pass = 0; pass < 5; pass++) {
        const sortedWorks = Array.from(tracker.workedDates).sort();
        let streak: string[] = [];
        let violatedStreak: string[] | null = null;
        for (const dStr of sortedWorks) {
          if (streak.length === 0) {
            streak = [dStr];
          } else {
            const prev = new Date(streak[streak.length - 1].replace(/-/g, '/'));
            const curr = new Date(dStr.replace(/-/g, '/'));
            const diff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 3600 * 24));
            if (diff === 1) streak.push(dStr);
            else {
              if (streak.length >= 6) {
                violatedStreak = streak;
                break;
              }
              streak = [dStr];
            }
          }
        }
        if (!violatedStreak && streak.length >= 6) violatedStreak = streak;
        if (violatedStreak) {
          const midIdx = Math.floor(violatedStreak.length / 2);
          let targetDate: string | null = null;
          const candidateOrder = [midIdx, midIdx + 1, midIdx - 1, midIdx + 2, midIdx - 2, 0, violatedStreak.length - 1];
          for (const idx of candidateOrder) {
            const d = violatedStreak[idx];
            if (d && weekdayDates.includes(d) && !hasManualShift(tracker.id, d)) {
              targetDate = d;
              break;
            }
          }
          if (targetDate) {
            tracker.workedDates.delete(targetDate);
            tracker.totalWorkCount--;
            const idx = generatedShifts.findIndex(
              s => s.staff_id === tracker.id && s.date === targetDate && s.type === '出勤'
            );
            if (idx !== -1) generatedShifts.splice(idx, 1);
            assignOffShift(tracker, targetDate, '公休', 'streak_break_fix');
          } else break;
        } else break;
      }
    });

    // Step E: DB UPSERT
    if (generatedShifts.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < generatedShifts.length; i += chunkSize) {
        const chunk = generatedShifts.slice(i, i + chunkSize);
        const cleanChunk = chunk.map((s: any) => {
          const rawStaffId = String(s.staff_id ?? '').trim();
          const validStaffId = UUID_REGEX.test(rawStaffId) ? rawStaffId : null;
          return {
            id: ensureValidUuid(s.id),
            staff_id: validStaffId,
            staff_name: s.staff_name ?? null,
            date: String(s.date ?? ''),
            type: String(s.type ?? '出勤'),
            status: String(s.status ?? 'approved'),
            is_manual: false,
            details: s.details ? JSON.parse(JSON.stringify(s.details)) : null,
          };
        });
        const { error: upsertError } = await supabase.from('shifts').upsert(cleanChunk, { onConflict: 'id' });
        if (upsertError) {
          console.error('[ShiftEngine] shifts テーブルへの保存エラー:', upsertError);
          throw new Error(`シフトのDB保存に失敗しました (${upsertError.code || 'ERROR'}): ${upsertError.message}`);
        }
      }
      console.log(`[ShiftEngine] 保存成功: ${generatedShifts.length}件`);
    }

    return generatedShifts;
  } catch (error: any) {
    console.error('[ShiftEngine] 致命的エラー:', error);
    throw error;
  }
};
