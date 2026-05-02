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

const extractUuid = (id: string) => {
  if (!id) return '';
  const parts = id.split('-');
  // auto-UUID-DATE-... または m-UUID-DATE-... 形式 (1 + 5 + ...)
  if (parts.length >= 6) return parts.slice(1, 6).join('-');
  // それ以外（req-TIMESTAMP など）はそのまま、または末尾5要素（レガシー対応）
  if (parts.length >= 5) return parts.slice(-5).join('-');
  return id;
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
  console.log(`[BUILD: VERSION 72.2 - ID MATCH] 処理開始: ${year}年${month}月`);
  console.log('══════════════════════════════════════════════');

  try {
    // Step 0: 自動生成シフトを削除
    const { error: deleteError } = await supabase
      .from('shifts')
      .delete()
      .like('id', 'auto-%')
      .gte('date', startDate)
      .lte('date', endDateStr);

    if (deleteError) {
      console.error('[ShiftEngine] 自動シフトの削除に失敗:', deleteError.message);
      await supabase.from('shifts').delete().gte('date', startDate).lte('date', endDateStr);
    }

    // Step 0.2: 前月末シフトをロード（連勤防止用）
    const prevMonthEnd = new Date(year, jsMonth, 0);
    const prevMonthStart = new Date(year, jsMonth, -6);
    const { data: prevShifts } = await supabase
      .from('shifts')
      .select('*')
      .gte('date', getDateStr(prevMonthStart))
      .lte('date', getDateStr(prevMonthEnd))
      .in('type', ['出勤', '日勤']);

    // Step 0.5: 現月シフト・申請をロード
    const { data: currentShifts } = await supabase
      .from('shifts').select('*').gte('date', startDate).lte('date', endDateStr);

    const { data: currentRequests } = await supabase
      .from('requests').select('*').gte('date', startDate).lte('date', endDateStr).eq('status', 'approved');

    const manualDayMap = new Map<string, any>();
    (currentShifts || []).forEach(s => {
      const isAuto = String(s.id || '').startsWith('auto-');
      const isManualFlag = s.is_manual === true || s.details?.isManual === true;
      if (!isAuto || isManualFlag) {
        const dKey = s.date.substring(0, 10);
        const sId = String(s.staff_id || s.user_id || extractUuid(s.id) || '').trim();
        if (sId) manualDayMap.set(`${dKey}_${sId}`, s);
      }
    });
    (currentRequests || []).forEach(r => {
      const dKey = r.date.substring(0, 10);
      const sId = String(r.user_id || r.staff_id || extractUuid(r.id) || '').trim();
      const sName = normalizeName(r.staff_name || r.staffName || '');
      if (sId) manualDayMap.set(`${dKey}_${sId}`, r);
      if (sName) manualDayMap.set(`${dKey}_name_${sName}`, r);
    });
    const manualShifts = Array.from(manualDayMap.values());

    // Step A: スタッフ取得
    const { data: staffData, error: staffError } = await supabase.from('staff').select('*');
    if (staffError) throw staffError;

    const eligibleForFilter = (staffData || []).filter(staff => {
      const status = (staff.status || '').trim();
      const placement = (staff.placement || '').trim();
      const profession = (staff.profession || staff.jobType || '').trim();
      const role = (staff.role || '').trim();
      if (status.includes('長期休暇')) return false;
      if (placement.includes('訪問リハ')) return false;
      if (profession.includes('助手')) return false;
      if (placement.includes('助手')) return false;
      if (role.includes('助手')) return false;
      return true;
    });

    // Step B: 承認済み休暇申請
    const { data: approvedLeaves } = await supabase
      .from('requests')
      .select('staff_name, user_id, date, type, status')
      .like('date', `${monthPrefix}%`)
      .eq('status', 'approved')
      .not('type', 'in', '("出勤")');

    const leaveSet = new Set<string>();
    (approvedLeaves || []).forEach((r: any) => {
      const uid = r.user_id || extractUuid(r.id);
      if (uid && r.date) leaveSet.add(`uid__${uid}__${r.date}`);
      if (r.staff_name && r.date) leaveSet.add(`name__${normalizeName(r.staff_name)}__${r.date}`);
    });

    const hasLeave = (tracker: StaffTracker, dateStr: string): boolean => {
      const normName = normalizeName(tracker.name);
      return leaveSet.has(`uid__${tracker.id}__${dateStr}`) ||
        (normName ? leaveSet.has(`name__${normName}__${dateStr}`) : false);
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

    const targetWorkDays = weekdayDates.length;

    // Step D: スタッフトラッカー初期化
    const trackers = new Map<string, StaffTracker>();
    const manualWorkCountPerDay = new Map<string, number>();

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
        const msId = String(ms.staff_id || ms.user_id || extractUuid(ms.id) || '').trim();
        const msName = normalizeName(ms.staff_name || ms.staffName || '');
        if ((msId && msId === staff.id) || (msName && msName === normalizeName(staff.name))) {
          const dKey = ms.date.substring(0, 10);
          if (ms.type === '出勤') {
            tracker.workedDates.add(dKey);
            tracker.totalWorkCount++;
            if (getDayType(new Date(ms.date.replace(/-/g, '/'))) !== 'weekday') tracker.holidayWorkCount++;
            manualWorkCountPerDay.set(dKey, (manualWorkCountPerDay.get(dKey) || 0) + 1);
          }
        }
      });
      trackers.set(staff.id, tracker);
      (prevShifts || []).forEach((ps: any) => {
        const psId = String(ps.staff_id || ps.user_id || extractUuid(ps.id) || '').trim();
        const psName = normalizeName(ps.staff_name || '');
        if ((psId && psId === staff.id) || (psName && psName === normalizeName(staff.name))) {
          tracker.workedDates.add(ps.date.substring(0, 10));
        }
      });
    });

    const hasManualShift = (staffId: string, dateStr: string): boolean => {
      const tracker = trackers.get(staffId);
      const normName = tracker ? normalizeName(tracker.name) : '';
      return (manualShifts || []).some((ms: any) => {
        const msId = String(ms.staff_id || ms.user_id || extractUuid(ms.id) || '').trim();
        const msName = normalizeName(ms.staff_name || ms.staffName || '');
        const dateMatch = ms.date.substring(0, 10) === dateStr;
        if (!dateMatch) return false;
        return (msId && msId === staffId) || (msName && normName && msName === normName);
      });
    };

    const generatedShifts: any[] = [];

    const assignOffShift = (tracker: StaffTracker, dateStr: string, type: string, phase: string) => {
      generatedShifts.push({
        id: `auto-off-${tracker.id}-${dateStr}-${Math.random().toString(36).substr(2, 6)}`,
        staff_name: tracker.name, staff_id: tracker.id, date: dateStr, type,
        status: 'approved',
        details: { isManual: false, phase, note: `V72.2 ${phase}` }
      });
      tracker.forcedOffDates.add(dateStr);
    };

    const assignShift = (tracker: StaffTracker, dateStr: string, dayType: string, phase: string) => {
      generatedShifts.push({
        id: `auto-${tracker.id}-${dateStr}-${Math.random().toString(36).substr(2, 6)}`,
        staff_name: tracker.name, staff_id: tracker.id, date: dateStr, type: '出勤',
        status: 'approved',
        details: { isManual: false, phase, dayType, isHolidayWork: dayType !== 'weekday', note: `V72.2 ${phase}` }
      });
      tracker.totalWorkCount++;
      tracker.workedDates.add(dateStr);
      if (dayType !== 'weekday') {
        tracker.holidayWorkCount++;
        findAndSetCompOff(tracker, dateStr, weekdayDates, generatedShifts);
      }
    };

    function findAndSetCompOff(tracker: StaffTracker, holidayDateStr: string, weekdays: string[], currentGenerated: any[]) {
      const hDate = new Date(holidayDateStr.replace(/-/g, '/'));
      const getWeekStart = (d: Date) => {
        const date = new Date(d.getTime());
        const day = date.getDay();
        date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
        return date;
      };
      const weekStart = getWeekStart(hDate);
      const candidates: string[] = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const dStr = getDateStr(d);
        if (weekdays.includes(dStr) && !tracker.workedDates.has(dStr) && !tracker.forcedOffDates.has(dStr) && !hasLeave(tracker, dStr)) {
          candidates.push(dStr);
        }
      }
      if (candidates.length === 0) {
        console.warn(`[ShiftEngine] ${tracker.name}: 振休を同週内に割り当てられませんでした(${holidayDateStr})`);
        return;
      }
      const sorted = candidates.sort((a, b) => {
        const cA = currentGenerated.filter(s => s.date === a && s.details?.phase === 'holiday_comp_off').length;
        const cB = currentGenerated.filter(s => s.date === b && s.details?.phase === 'holiday_comp_off').length;
        return cA - cB;
      });
      assignOffShift(tracker, sorted[0], '公休', 'holiday_comp_off');
    }

    // ═══════════════════════════════════════════
    // HOLIDAY ASSIGNMENTS
    // ═══════════════════════════════════════════
    console.log('--- STARTING HOLIDAY ASSIGNMENTS ---');

    if (!holidayDates || holidayDates.length === 0) {
      console.error('CRITICAL ERROR: holidayDates is empty!');
    } else {
      const sortedStaffList = HOLIDAY_ROTATION_ORDER.map(name => {
        const normName = normalizeName(name);
        return eligibleForFilter.find(s => normalizeName(s.name) === normName);
      }).filter(s => s !== undefined) as any[];

      const sanitize = (str: any) => String(str || '').replace(/[\s\u3000]/g, '');
      let currentStaffIndex = 0;

      try {
        // 直近40日間の休日シフトを取得（年末年始の月跨ぎをカバー）
        const searchStartDate = new Date(year, jsMonth, -40);
        const searchEndDate = new Date(year, jsMonth, 0);

        const { data: recentShifts, error: rErr } = await supabase
          .from('shifts')
          .select('staff_name, staff_id, date, details, type')
          .gte('date', getDateStr(searchStartDate))
          .lte('date', getDateStr(searchEndDate))
          .in('type', ['出勤', '日勤'])
          .order('date', { ascending: false });

        if (rErr) throw rErr;
        console.log(`[ShiftEngine] 引継ぎ用データ取得件数: ${recentShifts?.length ?? 0}件`);

        if (recentShifts && recentShifts.length > 0) {
          // holiday_strict_sequence フェーズを優先検索
          let lastShift = recentShifts.find(s => s.details?.phase === 'holiday_strict_sequence');

          if (!lastShift) {
            console.log('[ShiftEngine] フェーズ未検出。日付ベースで検索します');
            lastShift = recentShifts.find(s => {
              const d = new Date(String(s.date).replace(/-/g, '/'));
              const day = d.getDay();
              const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              const isNewYear = ['12-28', '12-29', '12-30', '12-31', '01-01', '01-02', '01-03'].includes(mmdd);
              return day === 0 || day === 6 || isNewYear;
            });
          }

          if (lastShift) {
            const lastDate = lastShift.date;
            const staffOnLastDate = recentShifts.filter(s => s.date === lastDate);
            console.log(`[ShiftEngine] 引継ぎ基準日: ${lastDate}, スタッフ: [${staffOnLastDate.map(s => s.staff_name).join(', ')}]`);

            // staff_id優先 → 名前フォールバックの照合
            const indices = staffOnLastDate.map(row => {
              const dbId = row.staff_id;
              const dbName = row.staff_name;

              // 1. staff_id（UUID）で直接照合（最優先）
              if (dbId) {
                const idx = sortedStaffList.findIndex((s: any) => s.id === dbId);
                if (idx !== -1) {
                  console.log(`[ShiftEngine]   ID照合成功: "${dbName}" → index:${idx}`);
                  return idx;
                }
              }

              // 2. 名前照合（フォールバック）
              const cleanDb = sanitize(dbName);
              const normDb = normalizeName(dbName);
              let idx = sortedStaffList.findIndex((s: any) => sanitize(s.name) === cleanDb);
              if (idx === -1) idx = sortedStaffList.findIndex((s: any) => normalizeName(s.name) === normDb);
              if (idx === -1) {
                idx = sortedStaffList.findIndex((s: any) => {
                  const n = sanitize(s.name);
                  return n.includes(cleanDb) || cleanDb.includes(n);
                });
              }
              console.log(`[ShiftEngine]   名前照合: "${dbName}" → "${cleanDb}" → index:${idx}`);
              return idx;
            }).filter(i => i !== -1);

            console.log(`[ShiftEngine] マッチしたインデックス: [${indices.join(', ')}]`);

            if (indices.length > 0) {
              // 昇順ソートしてから「次の人が同日セットにいない人」を最終担当者とする
              const sortedIndices = [...indices].sort((a, b) => a - b);
              let lastIdx = sortedIndices[sortedIndices.length - 1];
              for (const idx of sortedIndices) {
                const nextIdx = (idx + 1) % sortedStaffList.length;
                if (!sortedIndices.includes(nextIdx)) {
                  lastIdx = idx;
                  break;
                }
              }
              currentStaffIndex = (lastIdx + 1) % sortedStaffList.length;
              console.log(`[ShiftEngine] 月またぎ引継ぎ成功: 前月最後(${lastDate})の次 → index:${currentStaffIndex} = ${sortedStaffList[currentStaffIndex]?.name}`);
            } else {
              console.warn('[ShiftEngine] 引継ぎ失敗: スタッフがリストに見つかりません。index=0から開始。');
            }
          } else {
            console.warn('[ShiftEngine] 前月の休日シフトが見つかりません。index=0から開始。');
          }
        }
      } catch (e) {
        console.error('[ShiftEngine] 引継ぎ計算エラー:', e);
      }

      for (const { dateStr, dayType, cap } of holidayDates) {
        let assignedCountForDay = 0;
        let loopFailsafe = 0;

        while (assignedCountForDay < cap && loopFailsafe < sortedStaffList.length * 2) {
          const person = sortedStaffList[currentStaffIndex % sortedStaffList.length];
          const tracker = trackers.get(person.id)!;

          if (!tracker.workedDates.has(dateStr) && !tracker.forcedOffDates.has(dateStr) && !hasLeave(tracker, dateStr)) {
            generatedShifts.push({
              id: `auto-${tracker.id}-${dateStr}-${Math.random().toString(36).substr(2, 6)}`,
              staff_name: tracker.name, staff_id: tracker.id, date: dateStr, type: '出勤',
              status: 'approved',
              details: {
                isManual: false, phase: 'holiday_strict_sequence', dayType,
                isHolidayWork: true, staffName: tracker.name, note: 'V72.2 ID Match'
              }
            });
            tracker.totalWorkCount++;
            tracker.workedDates.add(dateStr);
            tracker.holidayWorkCount++;
            findAndSetCompOff(tracker, dateStr, weekdayDates, generatedShifts);
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
    }
    console.log('--- FINISHED HOLIDAY ASSIGNMENTS ---');

    // Pass 3: 平日割り当て
    console.log('\n[ShiftEngine] ════ Pass 3: 平日割り当て ════');
    for (const dateStr of weekdayDates) {
      let assignedForDay = manualWorkCountPerDay.get(dateStr) || 0;
      const staffArray = Array.from(trackers.values());
      const baseAvailable = staffArray.filter(t => {
        if (t.workedDates.has(dateStr)) return false;
        if (hasLeave(t, dateStr)) return false;
        if (t.forcedOffDates.has(dateStr)) return false;
        if (hasManualShift(t.id, dateStr)) return false;
        if (wouldViolateStreak(dateStr, t.workedDates)) return false;
        return true;
      });
      const neededCount = Math.max(0, limits.weekdayCap - assignedForDay);
      if (neededCount === 0) continue;
      const underTarget = baseAvailable
        .filter(t => t.totalWorkCount < targetWorkDays)
        .sort((a, b) => a.totalWorkCount - b.totalWorkCount);
      let assignedCount = 0;
      for (const t of underTarget) {
        if (assignedCount >= neededCount) break;
        assignShift(t, dateStr, 'weekday', 'weekday_equalization');
        assignedCount++;
      }
      console.log(`[ShiftEngine] ${dateStr}(weekday): ${assignedCount}人 合計${assignedForDay + assignedCount}/${limits.weekdayCap}`);
    }

    // Pass 4: Streak Breaker
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
              if (streak.length >= 6) { violatedStreak = streak; break; }
              streak = [dStr];
            }
          }
        }
        if (!violatedStreak && streak.length >= 6) violatedStreak = streak;
        if (violatedStreak) {
          const midIdx = Math.floor(violatedStreak.length / 2);
          let targetDate: string | null = null;
          for (const idx of [midIdx, midIdx + 1, midIdx - 1, midIdx + 2, midIdx - 2]) {
            const d = violatedStreak[idx];
            if (d && !hasManualShift(tracker.id, d)) { targetDate = d; break; }
          }
          if (targetDate) {
            tracker.workedDates.delete(targetDate);
            tracker.totalWorkCount--;
            const idx = generatedShifts.findIndex(s => s.staff_id === tracker.id && s.date === targetDate && s.type === '出勤');
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
        const cleanChunk = chunk.map((s: any) => ({
          id: String(s.id ?? ''),
          staff_id: s.staff_id ?? null,
          staff_name: s.staff_name ?? null,
          date: String(s.date ?? ''),
          type: String(s.type ?? '出勤'),
          status: String(s.status ?? 'approved'),
          details: s.details ? JSON.parse(JSON.stringify(s.details)) : null,
        }));
        await supabase.from('shifts').upsert(cleanChunk, { onConflict: 'id' });
      }
      console.log(`[ShiftEngine] 保存成功: ${generatedShifts.length}件`);
    }

    return generatedShifts;
  } catch (error: any) {
    console.error('[ShiftEngine] 致命的エラー:', error);
    throw error;
  }
};
