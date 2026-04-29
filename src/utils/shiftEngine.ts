import { supabase } from './supabase';
import { getDayType, getDateStr, normalizeName } from './dateUtils';

// ─────────────────────────────────────────────
// [BUILD: VERSION 57.2 - HOLIDAY CAP FIX]
// ─────────────────────────────────────────────

interface ShiftTargetLimits {
  weekdayCap: number;
  satCap: number;
  sunCap: number;
  holidayCap: number;
}

const HOLIDAY_ROTATION_ORDER = [
  '佐藤公貴', '佐藤', '三井', '阿部', '藤森', '坂下', '佐久間', '中野',
  '山川', '久保田', '小笠原', '森田', '駒津', '馬淵', '吉田'
];

interface StaffTracker {
  id: string;
  name: string;
  totalWorkCount: number;    // 月の総出勤数
  holidayWorkCount: number;  // 休日出勤数（公平化用）
  workedDates: Set<string>;  // 出勤済み日付セット（連勤チェック用）
  isWeekendOff: boolean;    // 土日祝休み設定
  forcedOffDates: Set<string>; // [V55.2] 休日振替や連勤調整で強制的に休みとする日
}

/**
 * ID文字列からUUIDを抽出します (auto-UUID-... or m-UUID-...)
 * [V57.3] 完全にUUIDベースに移行するための補助関数
 */
const extractUuid = (idStr: string): string | null => {
  if (!idStr) return null;
  const parts = idStr.split('-');
  if (parts.length >= 6) {
    // 8-4-4-4-12 の形式を再構築
    return parts.slice(1, 6).join('-');
  }
  return null;
};

// ─────────────────────────────────────────────
// 連勤チェック関数 (V53.3)
// Rule: いかなる時点でも6連勤以上にならないことを保証する
// ─────────────────────────────────────────────
function wouldViolateStreak(
  dateStr: string,
  workedDates: Set<string>,
  maxStreak: number = 5
): boolean {
  try {
    if (!dateStr) return false;
    const date = new Date(dateStr.replace(/-/g, '/'));
    if (isNaN(date.getTime())) return false; // 無効な日付は無視
    
    // 仮の出勤セットを作成してシミュレーション
    const simulated = new Set(workedDates);
    simulated.add(dateStr);

    // 対象日の前後1週間を走査し、6連勤以上が発生しないかチェック
    for (let startOffset = -maxStreak; startOffset <= 0; startOffset++) {
      let streakCount = 0;
      let isViolated = true;
      
      for (let i = 0; i <= maxStreak; i++) {
        const d = new Date(date);
        d.setDate(d.getDate() + startOffset + i);
        const dStr = getDateStr(d);
        
        // 日付がNaNになる等の異常系を回避
        if (dStr.includes('NaN')) {
          isViolated = false;
          break;
        }

        if (simulated.has(dStr)) {
          streakCount++;
        } else {
          isViolated = false;
          break;
        }
      }
      
      if (isViolated && streakCount > maxStreak) return true;
    }
  } catch (e) {
    console.error("[ShiftEngine] Streak validation error for " + dateStr, e);
    return false; // エラー時は安全側に倒して「違反なし」とする（配置を優先）
  }

  return false;
}

// ─────────────────────────────────────────────
// シフト生成本体 (V52.3)
// ─────────────────────────────────────────────
export const generateMonthlyShifts = async (
  year: number,
  month: number,
  limits: ShiftTargetLimits
) => {
  const jsMonth = month - 1;
  const lastDay = new Date(year, jsMonth + 1, 0).getDate();
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  // 対象月の範囲を算出（累積防止用）
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  // [V60.4] 2026年7月のアンロック（ユーザー要望により最新ルールでの再生成を許可）
  // if (year === 2026 && month === 7) { ... }

  console.log('══════════════════════════════════════════════');
  console.log(`[BUILD: VERSION 62.0 - STRICT SEQUENTIAL HOLIDAYS] 処理開始: ${year}年${month}月`);
  console.log("[Engine Debug] 既存のシフトを削除します:", monthPrefix);
  console.log('══════════════════════════════════════════════');

  try {
    // ═══════════════════════════════════════════
    // Step 0: 自動生成されたシフトを強制削除（クリーンアップ）
    // ═══════════════════════════════════════════
    const { error: deleteError } = await supabase
      .from('shifts')
      .delete()
      .like('id', 'auto-%') // auto- で始まるものは強制削除
      .gte('date', startDate)
      .lte('date', endDateStr);

    if (deleteError) {
      console.error("[ShiftEngine] 自動シフトの削除に失敗しました:", deleteError.message);
      await supabase.from('shifts').delete().gte('date', startDate).lte('date', endDateStr);
    }

    // ═══════════════════════════════════════════
    // Step 0.2: 前月末のシフトをロード（月跨ぎ連勤防止）
    // ═══════════════════════════════════════════
    const prevMonthEnd = new Date(year, jsMonth, 0);
    const prevMonthStart = new Date(year, jsMonth, -6);
    const prevStartDate = getDateStr(prevMonthStart);
    const prevEndDate = getDateStr(prevMonthEnd);

    const { data: prevShifts } = await supabase
      .from('shifts')
      .select('*')
      .gte('date', prevStartDate)
      .lte('date', prevEndDate)
      .in('type', ['出勤', '日勤']);

    // ═══════════════════════════════════════════
    // Step 0.5: シフトデータをロード（制約として使用）
    // ═══════════════════════════════════════════
    const { data: currentShifts } = await supabase
      .from('shifts')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDateStr);

    const { data: currentRequests } = await supabase
      .from('requests')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDateStr)
      .eq('status', 'approved');

    const manualDayMap = new Map<string, any>();
    (currentShifts || []).forEach(s => {
      const isAuto = String(s.id || '').startsWith('auto-');
      const isManualFlag = s.is_manual === true || s.details?.isManual === true;
      if (!isAuto || isManualFlag) {
        const dKey = s.date.substring(0, 10);
        const extractedId = extractUuid(s.id);
        const sId = String(s.staff_id || s.user_id || extractedId || '').trim();
        if (sId) manualDayMap.set(`${dKey}_${sId}`, s);
      }
    });
    (currentRequests || []).forEach(r => {
      if (r.type === '出勤') {
        const dKey = r.date.substring(0, 10);
        const extractedId = extractUuid(r.id);
        const sId = String(r.user_id || r.staff_id || extractedId || '').trim();
        if (sId) manualDayMap.set(`${dKey}_${sId}`, r);
      }
    });

    const manualShifts = Array.from(manualDayMap.values());

    // ═══════════════════════════════════════════
    // Step A: スタッフ取得 + 除外フィルタ
    // ═══════════════════════════════════════════
    const { data: staffData, error: staffError } = await supabase.from('staff').select('*');
    if (staffError) throw staffError;

    const eligibleForFilter = (staffData || []).filter(staff => {
      const status    = (staff.status     || '').trim();
      const placement = (staff.placement  || '').trim();
      const profession= (staff.profession || staff.jobType || '').trim();
      const role      = (staff.role       || '').trim();
      if (status.includes('長期休暇'))   return false;
      if (placement.includes('訪問リハ')) return false;
      if (profession.includes('助手'))      return false;
      if (placement.includes('助手'))       return false;
      if (role.includes('助手'))            return false;
      return true;
    });

    // 固定順序に基づいたスタッフリストの作成 [V63.0]
    const holidayOrderStaff = HOLIDAY_ROTATION_ORDER.map(name => {
      const normName = normalizeName(name);
      return eligibleForFilter.find(s => normalizeName(s.name) === normName);
    }).filter(s => s !== undefined) as any[];

    console.log("[ShiftEngine] Step A: Data filtering/sorting completed.");
    console.log("[ShiftEngine] Holiday Rotation Order (Eligible):", holidayOrderStaff.map(s => s.name).join(', '));

    // ═══════════════════════════════════════════
    // Step B: 承認済み休暇申請を取得
    // ═══════════════════════════════════════════
    const { data: approvedLeaves } = await supabase
      .from('requests')
      .select('staff_name, user_id, date, type, status')
      .like('date', `${monthPrefix}%`)
      .eq('status', 'approved')
      .not('type', 'in', '("出勤")');

    const leaveSet = new Set<string>();
    (approvedLeaves || []).forEach((r: any) => {
      const extractedId = extractUuid(r.id);
      const uid = r.user_id || extractedId;
      if (uid && r.date) leaveSet.add(`uid__${uid}__${r.date}`);
      if (r.staff_name && r.date) leaveSet.add(`name__${normalizeName(r.staff_name)}__${r.date}`);
    });

    const hasLeave = (tracker: StaffTracker, dateStr: string): boolean => {
      const normName = normalizeName(tracker.name);
      return leaveSet.has(`uid__${tracker.id}__${dateStr}`) ||
             (normName && leaveSet.has(`name__${normName}__${dateStr}`));
    };

    // ═══════════════════════════════════════════
    // Step C: 月の全日程を分類
    // ═══════════════════════════════════════════
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

    const totalWeekdays = weekdayDates.length;
    const targetWorkDays = totalWeekdays;

    // ═══════════════════════════════════════════
    // Step D: スタッフトラッカー初期化
    // ═══════════════════════════════════════════
    const trackers = new Map<string, StaffTracker>();
    const manualWorkCountPerDay = new Map<string, number>();

    eligibleForFilter.forEach((staff) => {
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
        const extractedId = extractUuid(ms.id);
        const msId = String(ms.staff_id || ms.user_id || extractedId || '').trim();
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
        const extractedId = extractUuid(ps.id);
        const psId = String(ps.staff_id || ps.user_id || extractedId || '').trim();
        const psName = normalizeName(ps.staff_name || '');
        if ((psId && psId === staff.id) || (psName && psName === normalizeName(staff.name))) {
          tracker.workedDates.add(ps.date.substring(0, 10));
        }
      });
    });

    const hasManualShift = (staffId: string, dateStr: string): boolean => {
      return (manualShifts || []).some((ms: any) => ms.staff_id === staffId && ms.date.substring(0, 10) === dateStr);
    };

    const generatedShifts: any[] = [];

    const assignOffShift = (tracker: StaffTracker, dateStr: string, type: string, phase: string) => {
      generatedShifts.push({
        id: `auto-off-${tracker.id}-${dateStr}-${Math.random().toString(36).substr(2, 6)}`,
        staff_name: tracker.name,
        staff_id: tracker.id,
        date: dateStr,
        type: type,
        status: 'approved',
        details: { isManual: false, phase, note: `V62.0 ${phase}` }
      });
      tracker.forcedOffDates.add(dateStr);
    };

    const assignShift = (tracker: StaffTracker, dateStr: string, dayType: string, phase: string) => {
      generatedShifts.push({
        id: `auto-${tracker.id}-${dateStr}-${Math.random().toString(36).substr(2, 6)}`,
        staff_name: tracker.name,
        staff_id: tracker.id,
        date: dateStr,
        type: '出勤',
        status: 'approved',
        details: { isManual: false, phase, dayType, note: `V62.0 ${phase}` }
      });
      tracker.totalWorkCount++;
      tracker.workedDates.add(dateStr);
      if (dayType !== 'weekday') {
        tracker.holidayWorkCount++;
        findAndSetCompOff(tracker, dateStr, weekdayDates, generatedShifts);
      }
    };

    // [V66.0] 振休を同週の月〜金の中で、最も振休が少ない日に分散させる
    function findAndSetCompOff(tracker: StaffTracker, holidayDateStr: string, weekdays: string[], currentGenerated: any[]) {
      const hDate = new Date(holidayDateStr.replace(/-/g, '/'));
      
      // 週の開始日（月曜日）を算出
      const getWeekStart = (d: Date) => {
        const date = new Date(d.getTime());
        const day = date.getDay();
        // 日曜(0)なら-6、それ以外は -(day-1)
        const diff = date.getDate() - (day === 0 ? 6 : day - 1);
        return new Date(date.setDate(diff));
      };
      const weekStart = getWeekStart(hDate);
      
      // 同週の月〜金(0-4)を候補にする
      const candidates: string[] = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const dStr = getDateStr(d);
        // 対象月内かつ、そのスタッフがまだ予定を入れていない日のみ
        if (weekdays.includes(dStr) && !tracker.workedDates.has(dStr) && !tracker.forcedOffDates.has(dStr) && !hasLeave(tracker, dStr)) {
          candidates.push(dStr);
        }
      }

      if (candidates.length === 0) {
        console.warn(`[ShiftEngine] ${tracker.name}: 休日出勤(${holidayDateStr})の振休を同週内に割り当てられませんでした。`);
        return;
      }

      // 各候補日の「既に割り当てられた振休数」をカウントして、最小の日を選ぶ
      const sortedCandidates = candidates.sort((a, b) => {
        const countA = currentGenerated.filter(s => s.date === a && s.details?.phase === 'holiday_comp_off').length;
        const countB = currentGenerated.filter(s => s.date === b && s.details?.phase === 'holiday_comp_off').length;
        return countA - countB;
      });

      const targetDate = sortedCandidates[0];
      assignOffShift(tracker, targetDate, '公休', 'holiday_comp_off');
      console.log(`[ShiftEngine] ${tracker.name}: 休日出勤(${holidayDateStr})の振休を週内の負荷分散により ${targetDate} に割り当てました。`);
    }

    // ═══════════════════════════════════════════
    // Pass 2: 休日・土日の割り当て (厳格な固定順ローテーション)
    // ═══════════════════════════════════════════
    console.log('\n[ShiftEngine] ════ Pass 2: 休日割り当て (固定順ローテーション) ════');
    
    // [V65.0] 月ごとの開始ポインタ調整
    let currentHolidayPtr = 0; 
    if (year === 2026 && month === 11) {
      // 11月は佐藤公貴（新リストの1番目）から開始
      currentHolidayPtr = 0;
      console.log(`[ShiftEngine] 2026年11月の特定ルール適用: ${HOLIDAY_ROTATION_ORDER[currentHolidayPtr]} から開始します。`);
    }

    const holidayWorkedInMonth = new Set<string>(); // 月内での重複出勤防止

    for (const { dateStr, dayType, cap } of holidayDates) {
      let assignedOnDay = manualWorkCountPerDay.get(dateStr) || 0;

      for (let slot = assignedOnDay; slot < cap; slot++) {
        let found = false;
        // ポインタの位置から1周チェック
        for (let i = 0; i < holidayOrderStaff.length; i++) {
          const idx = (currentHolidayPtr + i) % holidayOrderStaff.length;
          const staff = holidayOrderStaff[idx];
          const tracker = trackers.get(staff.id)!;

          // 基本条件チェック
          if (tracker.isWeekendOff) continue;
          if (tracker.workedDates.has(dateStr)) continue;
          if (hasLeave(tracker, dateStr)) continue;
          if (hasManualShift(staff.id, dateStr)) continue;
          if (wouldViolateStreak(dateStr, tracker.workedDates)) continue;

          // [V63.1] 月内公平性チェック: 全員が1回ずつ回るまで2回目は避ける
          if (holidayWorkedInMonth.has(staff.id)) {
            const anyOneElseNotWorked = holidayOrderStaff.some(s2 => {
              const t2 = trackers.get(s2.id)!;
              return !holidayWorkedInMonth.has(s2.id) && 
                     !t2.isWeekendOff && 
                     !t2.workedDates.has(dateStr) && 
                     !hasLeave(t2, dateStr) && 
                     !hasManualShift(s2.id, dateStr) && 
                     !wouldViolateStreak(dateStr, t2.workedDates);
            });
            if (anyOneElseNotWorked) continue;
          }

          // 配置確定
          assignShift(tracker, dateStr, dayType, 'holiday_strict_sequence');
          holidayWorkedInMonth.add(staff.id);
          console.log(`[ShiftEngine] ${dateStr}: ${staff.name} を配置 (固定順)`);
          currentHolidayPtr = (idx + 1) % holidayOrderStaff.length;
          found = true;
          assignedOnDay++;
          break;
        }
        if (!found) {
          console.warn(`[ShiftEngine] ${dateStr}: 配置可能なスタッフが見つかりませんでした。`);
          break;
        }
      }
      console.log(`[ShiftEngine] ${dateStr}(${dayType}): ${assignedOnDay}/${cap}人配置完了`);
    }

    // ═══════════════════════════════════════════
    // Pass 3: 平日割り当て (Relaxed Constraint)
    // ═══════════════════════════════════════════
    console.log('\n[ShiftEngine] ════ Pass 3: 平日割り当て ════');

    for (const dateStr of weekdayDates) {
      // [V53.2 FIX] 念のため、このループ内では土日祝を絶対に処理しないようガードを強化
      const dObj = new Date(dateStr.replace(/-/g, '/'));
      if (getDayType(dObj) !== 'weekday') {
        console.warn(`[ShiftEngine] Skipping non-weekday in Pass 3: ${dateStr}`);
        continue;
      }

      // 既に手動で配置されている人数をカウント
      let assignedForDay = manualWorkCountPerDay.get(dateStr) || 0;

      const staffArray = Array.from(trackers.values());
      const baseAvailable = staffArray.filter(t => {
        if (t.workedDates.has(dateStr))                 return false;
        if (hasLeave(t, dateStr))                        return false;
        if (t.forcedOffDates.has(dateStr))               return false; // [V55.2] 強制公休
        if (hasManualShift(t.id, dateStr))               return false; 
        if (wouldViolateStreak(dateStr, t.workedDates)) return false;
        return true;
      });

      // 目標人数（定員）までの不足分を算出
      const neededCount = Math.max(0, limits.weekdayCap - assignedForDay);
      if (neededCount === 0) {
        console.log(`[ShiftEngine] ${dateStr}(weekday): 手動シフトのみで定員(${limits.weekdayCap})を満たしています。`);
        continue;
      }

      // 目標稼働日数に達していないスタッフを抽出し、現在の出勤数が少ない順にソート（公平化）
      const underTarget = baseAvailable
        .filter(t => t.totalWorkCount < targetWorkDays)
        .sort((a, b) => a.totalWorkCount - b.totalWorkCount);
      
      // 不足分だけ割り当て
      let assignedCount = 0;
      for (const t of underTarget) {
        if (assignedCount >= neededCount) break;
        assignShift(t, dateStr, 'weekday', 'weekday_equalization');
        assignedCount++;
      }

      console.log(`[ShiftEngine] ${dateStr}(weekday): ${assignedCount}人を追加配置。合計 ${assignedForDay + assignedCount}/${limits.weekdayCap} 人`);
    }

    // ═══════════════════════════════════════════
    // Pass 4: ポストプロセス 連勤の強制分断 (V55.2)
    // ═══════════════════════════════════════════
    console.log('\n[ShiftEngine] ════ Pass 4: 連勤チェックと強制修正 ════');
    trackers.forEach(tracker => {
      // 最大5回ループして全ての6連勤を解消
      for (let pass = 0; pass < 5; pass++) {
        const sortedWorks = Array.from(tracker.workedDates).sort();
        let streak: string[] = [];
        let violatedStreak: string[] | null = null;

        for (let i = 0; i < sortedWorks.length; i++) {
          const dStr = sortedWorks[i];
          if (streak.length === 0) {
            streak = [dStr];
          } else {
            const prev = new Date(streak[streak.length - 1].replace(/-/g, '/'));
            const curr = new Date(dStr.replace(/-/g, '/'));
            const diff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 3600 * 24));
            if (diff === 1) {
              streak.push(dStr);
            } else {
              if (streak.length >= 6) { violatedStreak = streak; break; }
              streak = [dStr];
            }
          }
        }
        if (!violatedStreak && streak.length >= 6) violatedStreak = streak;

        if (violatedStreak) {
          // 連勤の真ん中あたりの「自動生成」の日を公休に変える
          const midIdx = Math.floor(violatedStreak.length / 2);
          let targetDate: string | null = null;
          
          // 真ん中から外側に向かって、自動生成の（is_manualでない）日を探す
          const searchIndices = [midIdx, midIdx + 1, midIdx - 1, midIdx + 2, midIdx - 2];
          for (const idx of searchIndices) {
            const d = violatedStreak[idx];
            if (!d) continue;
            // 手動シフトでないか確認
            if (!hasManualShift(tracker.id, d)) {
              targetDate = d;
              break;
            }
          }

          if (targetDate) {
            console.warn(`[ShiftEngine] STREAK_VIOLATION: ${tracker.name} が ${violatedStreak.length} 連勤しています。${targetDate} の出勤を取り消し公休にします。`);
            // 出勤データから削除
            tracker.workedDates.delete(targetDate);
            tracker.totalWorkCount--;
            // generatedShifts から出勤レコードを削除
            const idx = generatedShifts.findIndex(s => s.staff_id === tracker.id && s.date === targetDate && s.type === '出勤');
            if (idx !== -1) generatedShifts.splice(idx, 1);
            
            // [V55.4] 代わりに公休レコードを追加（DB保存用）
            assignOffShift(tracker, targetDate, '公休', 'streak_break_fix');
          } else {
            console.error(`[ShiftEngine] CRITICAL: ${tracker.name} の連勤を解除できません（全て手動設定のため）。`);
            break; 
          }
        } else {
          break; // 違反なし
        }
      }
    });

    console.log('\n[ShiftEngine] ════ 生成結果サマリー ════');
    console.log("[Engine Debug] Total shift records generated:", generatedShifts.length);
    
    // ═══════════════════════════════════════════
    // Step E: DB保存
    // ═══════════════════════════════════════════
    if (generatedShifts.length > 0) {
      console.log('\n[ShiftEngine] ════ DB保存開始 ════');
      const chunkSize = 200;
      for (let i = 0; i < generatedShifts.length; i += chunkSize) {
        const chunk = generatedShifts.slice(i, i + chunkSize);
        const cleanChunk = chunk.map((s: any) => ({
          id:         String(s.id ?? ''),
          staff_id:   s.staff_id   ?? null, // user_id ではなく staff_id が正しいカラム名
          staff_name: s.staff_name ?? null,
          date:       String(s.date ?? ''),
          type:       String(s.type ?? '出勤'),
          status:     String(s.status ?? 'approved'),
          // [V56.1] is_manual カラム未定義エラー防止のため、詳細は details.isManual に格納済み
          details:    s.details ? JSON.parse(JSON.stringify(s.details)) : null,
        }));

        const { error: insertError } = await supabase.from('shifts').insert(cleanChunk);
        if (insertError) {
          console.error('[ShiftEngine] DB保存エラー:', insertError.message);
          throw new Error(`DB保存エラー: ${insertError.message}`);
        }
      }
      console.log(`[ShiftEngine] 保存成功: ${generatedShifts.length}件`);
    } else {
      console.warn('[ShiftEngine] 生成されたシフトが0件のため、保存をスキップしました。');
    }

    console.log('[ShiftEngine] ════ Shift assignment completed. ════');
    console.log('[ShiftEngine] ════ 処理完了 ════\n');
    return generatedShifts;

  } catch (error: any) {
    console.error('[ShiftEngine] 致命的エラー:', error.message || error);
    throw error;
  }
};
