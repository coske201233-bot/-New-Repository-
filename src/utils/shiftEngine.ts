import { supabase } from './supabase';
import { getDayType, getDateStr } from './dateUtils';

// ─────────────────────────────────────────────
// [BUILD: VERSION 53.6 - PROTECTED MANUAL ASSIGNMENT]
// ─────────────────────────────────────────────

interface ShiftTargetLimits {
  weekdayCap: number;
  satCap: number;
  sunCap: number;
  holidayCap: number;
}

interface StaffTracker {
  id: string;
  name: string;
  totalWorkCount: number;    // 月の総出勤数
  holidayWorkCount: number;  // 休日出勤数（公平化用）
  workedDates: Set<string>;  // 出勤済み日付セット（連勤チェック用）
  isWeekendOff: boolean;    // 土日祝休み設定
}

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

  console.log('══════════════════════════════════════════════');
  console.log(`[BUILD: VERSION 53.0 - CLEAN SLATE] 処理開始: ${year}年${month}月`);
  console.log("[Engine Debug] 既存のシフトを削除します:", monthPrefix);
  console.log('══════════════════════════════════════════════');

  try {
    // ═══════════════════════════════════════════
    // Step 0: 自動生成されたシフトのみ削除（手動分を保護）
    // ═══════════════════════════════════════════
    const { error: deleteError } = await supabase
      .from('shifts')
      .delete()
      .eq('is_manual', false) // 【V53.6】手動フラグがないものだけ削除
      .gte('date', startDate)
      .lte('date', endDateStr);

    if (deleteError) {
      console.error("[ShiftEngine] 自動シフトの削除に失敗しました（カラム未定義の可能性あり）:", deleteError.message);
      // カラムがない場合は一旦全削除にフォールバック（初回移行用）
      await supabase.from('shifts').delete().gte('date', startDate).lte('date', endDateStr);
    } else {
      console.log('[ShiftEngine] 自動シフトの削除（クリーンアップ）が完了しました。');
    }

    // ═══════════════════════════════════════════
    // Step 0.5: 手動シフトを事前ロード（制約として使用）
    // ═══════════════════════════════════════════
    const { data: manualShifts } = await supabase
      .from('shifts')
      .select('*')
      .eq('is_manual', true)
      .gte('date', startDate)
      .lte('date', endDateStr);

    console.log(`[ShiftEngine] 手動シフト ${manualShifts?.length || 0} 件を保護・制約としてロードしました。`);
    // ═══════════════════════════════════════════
    // Step A: スタッフ取得 + 除外フィルタ
    // ═══════════════════════════════════════════
    const { data: staffData, error: staffError } = await supabase.from('staff').select('*');
    if (staffError) throw staffError;

    console.log("[Engine Debug] Total Staff before filter:", (staffData || []).length);

    const rawEligible = (staffData || []).filter(staff => {
      const status    = (staff.status     || '').trim();
      const placement = (staff.placement  || '').trim();
      const profession= (staff.profession || staff.jobType || '').trim();
      const role      = (staff.role       || '').trim();
      
      // 除外判定（includesを使用して柔軟に判定）
      if (status.includes('長期休暇'))   return false;
      if (placement.includes('訪問リハ')) return false;
      if (profession.includes('助手'))      return false; // === から includes に変更して安全性を向上
      if (placement.includes('助手'))       return false;
      if (role.includes('助手'))            return false;
      return true;
    });

    console.log("[Engine Debug] Staff available for assignment:", rawEligible.length);
    if (rawEligible.length > 0) {
      console.log('[Engine Debug] Staff names:', rawEligible.map((s: any) => s.name).join(', '));
    }

    if (rawEligible.length === 0) {
      const err = "割り当て対象のスタッフがいません。スタッフのステータス（長期休暇など）や職種、配置設定を確認してください。";
      console.error('[ShiftEngine]', err);
      throw new Error(err);
    }

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
      if (r.user_id    && r.date) leaveSet.add(`uid__${r.user_id}__${r.date}`);
      if (r.staff_name && r.date) leaveSet.add(`name__${r.staff_name}__${r.date}`);
    });
    console.log(`[ShiftEngine] 承認済み休暇件数: ${approvedLeaves?.length ?? 0}件`);

    const hasLeave = (tracker: StaffTracker, dateStr: string): boolean => {
      return leaveSet.has(`uid__${tracker.id}__${dateStr}`) ||
             leaveSet.has(`name__${tracker.name}__${dateStr}`);
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
    console.log("[Engine Debug] Weekdays in month:", totalWeekdays, "Target Work Days:", targetWorkDays);
    
    if (targetWorkDays === 0) {
      console.error('[Engine Debug] CRITICAL: targetWorkDays = 0! 日付判定ロジックを確認してください。');
    }

    // ═══════════════════════════════════════════
    // Step D: スタッフトラッカー初期化 (V53.6)
    // ═══════════════════════════════════════════
    const trackers = new Map<string, StaffTracker>();
    const manualWorkCountPerDay = new Map<string, number>();

    rawEligible.forEach(staff => {
      const isWeekendOff = !!(staff.no_holiday === true || staff.no_holiday === 'true' || staff.noHoliday === true);
      
      const tracker: StaffTracker = {
        id: staff.id,
        name: staff.name,
        totalWorkCount: 0,
        holidayWorkCount: 0,
        workedDates: new Set<string>(),
        isWeekendOff,
      };

      // 手動シフトをトラッカーと集計に反映
      (manualShifts || []).forEach((ms: any) => {
        if (ms.staff_id === staff.id) {
          const dKey = ms.date.substring(0, 10);
          if (ms.type === '出勤') {
            tracker.workedDates.add(dKey);
            tracker.totalWorkCount++;
            if (getDayType(new Date(ms.date.replace(/-/g, '/'))) !== 'weekday') {
              tracker.holidayWorkCount++;
            }
            manualWorkCountPerDay.set(dKey, (manualWorkCountPerDay.get(dKey) || 0) + 1);
          } else {
            // 公休などの手動設定も「予定あり」として記録し、二重割り当てを防止
            // workedDates には入れない（連勤チェックには影響させないが、hasShift等の判定に使う）
          }
        }
      });
      
      trackers.set(staff.id, tracker);
    });

    // 補助関数：特定の日に対象スタッフの「手動予定」があるか
    const hasManualShift = (staffId: string, dateStr: string): boolean => {
      return (manualShifts || []).some((ms: any) => ms.staff_id === staffId && ms.date.substring(0, 10) === dateStr);
    };

    const generatedShifts: any[] = [];

    const assignShift = (
      tracker: StaffTracker,
      dateStr: string,
      dayType: string,
      phase: string
    ) => {
      generatedShifts.push({
        id:         `auto-${tracker.id}-${dateStr}-${Math.random().toString(36).substr(2, 6)}`,
        staff_name: tracker.name,
        staff_id:   tracker.id,
        date:       dateStr,
        type:       '出勤',
        status:     'approved',
        is_manual:  false, // 【V53.6】AI生成分であることを明示
        details: {
          source:  'auto_engine_v53_6',
          phase,
          dayType,
          note:    `V53.6 ${phase}`
        }
      });
      tracker.totalWorkCount++;
      tracker.workedDates.add(dateStr);
      if (dayType !== 'weekday') tracker.holidayWorkCount++;
    };

    // ═══════════════════════════════════════════
    // Pass 2: 休日・土日の割り当て
    // ═══════════════════════════════════════════
    console.log('\n[ShiftEngine] ════ Pass 2: 休日割り当て ════');

    for (const { dateStr, dayType, cap } of holidayDates) {
      // 既に手動で配置されている人数をカウント
      let assignedOnDay = manualWorkCountPerDay.get(dateStr) || 0;

      for (let slot = 0; slot < cap; slot++) {
        const staffArray = Array.from(trackers.values());
        const available = staffArray.filter(t => {
          if (t.isWeekendOff) return false; // 【重要】土日祝休み設定のスタッフを除外
          if (t.workedDates.has(dateStr))                  return false;
          if (hasLeave(t, dateStr))                         return false;
          if (hasManualShift(t.id, dateStr))               return false; // 【V53.6】手動分はスキップ
          if (wouldViolateStreak(dateStr, t.workedDates))  return false;
          if (t.holidayWorkCount >= 3)                      return false; // 目安の上限
          return true;
        });

        if (slot === 0) {
          console.log(`[Engine Debug] ${dateStr} 休日出勤の候補者数 (土日祝休み除外後):`, available.length);
        }

        if (available.length === 0) break;

        available.sort((a, b) => {
          const diff = a.holidayWorkCount - b.holidayWorkCount;
          if (diff !== 0) return diff;
          return a.id < b.id ? -1 : 1;
        });

        assignShift(available[0], dateStr, dayType, 'holiday_round_robin');
        assignedOnDay++;
      }

      // フォールバック: 上限超えの投入
      if (assignedOnDay < cap) {
        for (let slot = assignedOnDay; slot < cap; slot++) {
          const staffArray = Array.from(trackers.values());
          const fallback = staffArray.filter(t => {
            if (t.isWeekendOff) return false; // 【重要】フォールバック時も土日祝休み設定を尊重
            if (t.workedDates.has(dateStr))                 return false;
            if (hasLeave(t, dateStr))                        return false;
            if (hasManualShift(t.id, dateStr))               return false; // 【V53.6】
            if (wouldViolateStreak(dateStr, t.workedDates)) return false;
            return true;
          });

          if (fallback.length === 0) break;

          fallback.sort((a, b) => {
            const diff = a.holidayWorkCount - b.holidayWorkCount;
            if (diff !== 0) return diff;
            return a.id < b.id ? -1 : 1;
          });

          assignShift(fallback[0], dateStr, dayType, 'holiday_emergency');
          assignedOnDay++;
        }
      }
      console.log(`[ShiftEngine] ${dateStr}(${dayType}): ${assignedOnDay}/${cap}人配置`);
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
        if (hasManualShift(t.id, dateStr))               return false; // 【V53.6】手動予定がある場合は飛ばす
        if (wouldViolateStreak(dateStr, t.workedDates)) return false;
        return true;
      });

      // 目標人数（定員）までの不足分を算出
      const neededCount = Math.max(0, limits.weekdayCap - assignedForDay);
      if (neededCount === 0) {
        console.log(`[ShiftEngine] ${dateStr}(weekday): 手動シフトのみで定員(${limits.weekdayCap})を満たしています。`);
        continue;
      }

      // 層1: 目標未達スタッフを優先
      const underTarget = baseAvailable.filter(t => t.totalWorkCount < targetWorkDays);
      underTarget.sort((a, b) => {
        const aNeed = targetWorkDays - a.totalWorkCount;
        const bNeed = targetWorkDays - b.totalWorkCount;
        if (bNeed !== aNeed) return bNeed - aNeed;
        return a.id < b.id ? -1 : 1;
      });

      let toAssign = underTarget.slice(0, limits.weekdayCap);

      // 層2: 目標達成済みスタッフをフォールバック投入 (人数の確保を最優先)
      if (toAssign.length < limits.weekdayCap) {
        const overTarget = baseAvailable
          .filter(t => t.totalWorkCount >= targetWorkDays)
          .sort((a, b) => {
            // 出勤数が少ない順に選ぶ（可能な限り公平に）
            if (a.totalWorkCount !== b.totalWorkCount) return a.totalWorkCount - b.totalWorkCount;
            return a.id < b.id ? -1 : 1;
          });
        
        const needed = limits.weekdayCap - toAssign.length;
        if (overTarget.length > 0) {
          console.log(`[Engine Debug] ${dateStr}: Relaxing targetWorkDays. Adding ${Math.min(needed, overTarget.length)} staff who reached target.`);
          toAssign = [...toAssign, ...overTarget.slice(0, needed)];
        }
      }

      toAssign.forEach(t => assignShift(t, dateStr, 'weekday', 'weekday_equalization'));

      // [V53.3 FALLBACK] 人数が足りない場合、連勤制限を一時的に緩和してでも埋める（医療体制の維持を最優先）
      if (toAssign.length < limits.weekdayCap) {
        const remainingNeeded = limits.weekdayCap - toAssign.length;
        console.warn(`[ShiftEngine] ${dateStr}: 平日人数不足 (${toAssign.length}/${limits.weekdayCap}). 連勤制限を緩和して補填を試みます。`);
        
        const desperateAvailable = staffArray.filter(t => {
          if (t.workedDates.has(dateStr)) return false;
          if (hasLeave(t, dateStr)) return false;
          // すでに割り当て済みの人は除外
          if (toAssign.some(assigned => assigned.id === t.id)) return false;
          return true; // 連勤チェックをスキップ
        }).sort((a, b) => a.totalWorkCount - b.totalWorkCount);

        const desperateFill = desperateAvailable.slice(0, remainingNeeded);
        if (desperateFill.length > 0) {
          console.log(`[Engine Debug] ${dateStr}: Streak rule relaxed for ${desperateFill.length} staff to meet hospital cap.`);
          desperateFill.forEach(t => assignShift(t, dateStr, 'weekday', 'weekday_desperate_fallback'));
          toAssign = [...toAssign, ...desperateFill];
        }
      }

      if (toAssign.length < limits.weekdayCap) {
        console.error(`[ShiftEngine] ${dateStr}: 【致命的】平日人数が最終的にも不足 (${toAssign.length}/${limits.weekdayCap})`);
      }

      console.log(`[ShiftEngine] ${dateStr}(weekday): ${toAssign.length}/${limits.weekdayCap}人配置完了`);
    }

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
          is_manual:  Boolean(s.is_manual ?? false), // 【V53.6】AI生成分(false)を明示
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

    console.log('[ShiftEngine] ════ 処理完了 ════\n');
    return generatedShifts;

  } catch (error: any) {
    console.error('[ShiftEngine] 致命的エラー:', error.message || error);
    throw error;
  }
};
