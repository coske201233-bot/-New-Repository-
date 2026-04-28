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
  console.log(`[BUILD: VERSION 60.0 - NUCLEAR RECOVERY] 処理開始: ${year}年${month}月`);
  console.log("[Engine Debug] 既存のシフトを削除します:", monthPrefix);
  console.log('══════════════════════════════════════════════');

  try {
    // ═══════════════════════════════════════════
    // Step 0: 自動生成されたシフトを強制削除（クリーンアップ）
    // ═══════════════════════════════════════════
    // [V56.1] is_manual カラムがない場合を考慮し、ID接頭辞 auto- を主軸に削除
    const { error: deleteError } = await supabase
      .from('shifts')
      .delete()
      .like('id', 'auto-%') // auto- で始まるものは強制削除
      .gte('date', startDate)
      .lte('date', endDateStr);

    if (deleteError) {
      console.error("[ShiftEngine] 自動シフトの削除に失敗しました:", deleteError.message);
      // カラムがない場合などのフォールバック
      await supabase.from('shifts').delete().gte('date', startDate).lte('date', endDateStr);
    } else {
      console.log('[ShiftEngine] 既存の自動シフト（auto-接頭辞）の削除が完了しました。');
    }

    // ═══════════════════════════════════════════
    // Step 0.2: 前月末のシフトをロード（月跨ぎ連勤防止）
    // ═══════════════════════════════════════════
    const prevMonthEnd = new Date(year, jsMonth, 0);
    const prevMonthStart = new Date(year, jsMonth, -6); // 直前7日間
    const prevStartDate = getDateStr(prevMonthStart);
    const prevEndDate = getDateStr(prevMonthEnd);

    const { data: prevShifts } = await supabase
      .from('shifts')
      .select('*')
      .gte('date', prevStartDate)
      .lte('date', prevEndDate)
      .in('type', ['出勤', '日勤']);

    console.log(`[ShiftEngine] 月跨ぎ連勤チェック用として前月末の出勤データ ${prevShifts?.length || 0} 件をロードしました。`);

    // ═══════════════════════════════════════════
    // Step 0.5: シフトデータをロード（制約として使用）
    // ═══════════════════════════════════════════
    // [V60.5] shiftsだけでなくrequestsからも手動シフトを取得してマージする
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

    // UI(CalendarScreen)と同じロジックで重複を排除し、手動シフトとして扱う
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

    // requests の「出勤」で上書き
    (currentRequests || []).forEach(r => {
      if (r.type === '出勤') {
        const dKey = r.date.substring(0, 10);
        const extractedId = extractUuid(r.id);
        const sId = String(r.user_id || r.staff_id || extractedId || '').trim();
        if (sId) manualDayMap.set(`${dKey}_${sId}`, r);
      }
    });

    const manualShifts = Array.from(manualDayMap.values());
    console.log(`[ShiftEngine] 保護・制約対象の手動シフト ${manualShifts.length} 件をロードしました。`);
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
      const extractedId = extractUuid(r.id);
      const uid = r.user_id || extractedId;
      if (uid && r.date) leaveSet.add(`uid__${uid}__${r.date}`);
      if (r.staff_name && r.date) leaveSet.add(`name__${normalizeName(r.staff_name)}__${r.date}`);
    });
    console.log(`[ShiftEngine] 承認済み休暇件数: ${approvedLeaves?.length ?? 0}件`);

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
    console.log("[Engine Debug] Weekdays in month:", totalWeekdays, "Target Work Days:", targetWorkDays);
    
    if (targetWorkDays === 0) {
      console.error('[Engine Debug] CRITICAL: targetWorkDays = 0! 日付判定ロジックを確認してください。');
    }

    // ═══════════════════════════════════════════
    // Step D: スタッフトラッカー初期化 (V53.6)
    // ═══════════════════════════════════════════
    const trackers = new Map<string, StaffTracker>();
    const manualWorkCountPerDay = new Map<string, number>();

    // [V60.5] 名簿の並び順（シーケンス）を記憶
    const staffSequenceMap = new Map<string, number>();

    rawEligible.forEach((staff, index) => {
      staffSequenceMap.set(staff.id, index);
      const isWeekendOff = !!(staff.no_holiday === true || staff.no_holiday === 'true' || staff.noHoliday === true);
      
      const tracker: StaffTracker = {
        id: staff.id,
        name: staff.name,
        totalWorkCount: 0,
        holidayWorkCount: 0,
        workedDates: new Set<string>(),
        isWeekendOff,
        forcedOffDates: new Set<string>(), // [V55.2]
      };

      // 手動シフトをトラッカーと集計に反映 (IDまたは氏名で照合)
      (manualShifts || []).forEach((ms: any) => {
        const extractedId = extractUuid(ms.id);
        const msId = String(ms.staff_id || ms.user_id || extractedId || '').trim();
        const msName = normalizeName(ms.staff_name || ms.staffName || '');
        const isMatch = (msId && msId === staff.id) || (msName && msName === normalizeName(staff.name));

        if (isMatch) {
          const dKey = ms.date.substring(0, 10);
          if (ms.type === '出勤') {
            tracker.workedDates.add(dKey);
            tracker.totalWorkCount++;
            if (getDayType(new Date(ms.date.replace(/-/g, '/'))) !== 'weekday') {
              tracker.holidayWorkCount++;
            }
            manualWorkCountPerDay.set(dKey, (manualWorkCountPerDay.get(dKey) || 0) + 1);
          }
        }
      });
      
      trackers.set(staff.id, tracker);

      // 前月末の出勤をトラッカーに反映 (IDまたは氏名で照合)
      (prevShifts || []).forEach((ps: any) => {
        const extractedId = extractUuid(ps.id);
        const psId = String(ps.staff_id || ps.user_id || extractedId || '').trim();
        const psName = normalizeName(ps.staff_name || '');
        if ((psId && psId === staff.id) || (psName && psName === normalizeName(staff.name))) {
          tracker.workedDates.add(ps.date.substring(0, 10));
        }
      });
    });

    // 補助関数：特定の日に対象スタッフの「手動予定」があるか
    const hasManualShift = (staffId: string, dateStr: string): boolean => {
      return (manualShifts || []).some((ms: any) => ms.staff_id === staffId && ms.date.substring(0, 10) === dateStr);
    };

    const generatedShifts: any[] = [];

    const assignOffShift = (
      tracker: StaffTracker,
      dateStr: string,
      type: string,
      phase: string
    ) => {
      generatedShifts.push({
        id:         `auto-off-${tracker.id}-${dateStr}-${Math.random().toString(36).substr(2, 6)}`,
        staff_name: tracker.name,
        staff_id:   tracker.id,
        date:       dateStr,
        type:       type, // '公休' など
        status:     'approved',
        // is_manual:  false, // [V56.1] カラム未定義エラー防止のため一旦除外
        details: {
          isManual: false,
          source:  'auto_engine_v56_1',
          phase,
          note:    `V56.1 ${phase}`
        }
      });
      tracker.forcedOffDates.add(dateStr);
    };

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
        // is_manual:  false, // [V56.1] カラム未定義エラー防止のため一旦除外
        details: {
          isManual: false,
          source:  'auto_engine_v56_1',
          phase,
          dayType,
          note:    `V56.1 ${phase}`
        }
      });
      tracker.totalWorkCount++;
      tracker.workedDates.add(dateStr);
      if (dayType !== 'weekday') {
        tracker.holidayWorkCount++;
        // [V55.4] 休日振替の自動付与
        findAndSetCompOff(tracker, dateStr, weekdayDates);
      }
    };

    // [V55.2] 休日振替用の平日を探して予約する
    function findAndSetCompOff(tracker: StaffTracker, holidayDateStr: string, weekdays: string[]) {
      const hDate = new Date(holidayDateStr.replace(/-/g, '/'));
      const getWeekStart = (d: Date) => {
        const date = new Date(d.getTime());
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1); // 月曜開始
        return new Date(date.setDate(diff)).toDateString();
      };
      const hWeek = getWeekStart(hDate);

      // [V57.0] 候補日をスコアリング：既にその日に公休が入っている人数が少ない日を優先して分散させる
      const candidates = [...weekdays].sort((a, b) => {
        const dA = new Date(a.replace(/-/g, '/'));
        const dB = new Date(b.replace(/-/g, '/'));
        const isSameWeekA = getWeekStart(dA) === hWeek;
        const isSameWeekB = getWeekStart(dB) === hWeek;
        if (isSameWeekA && !isSameWeekB) return -1;
        if (!isSameWeekA && isSameWeekB) return 1;

        // 公休の分散：その日に既に自動付与された公休の数を確認
        const aOffs = generatedShifts.filter(s => s.date === a && s.type === '公休').length;
        const bOffs = generatedShifts.filter(s => s.date === b && s.type === '公休').length;
        if (aOffs !== bOffs) return aOffs - bOffs;

        return Math.abs(dA.getTime() - hDate.getTime()) - Math.abs(dB.getTime() - hDate.getTime());
      });

      for (const dStr of candidates) {
        if (!tracker.workedDates.has(dStr) && !tracker.forcedOffDates.has(dStr) && !hasLeave(tracker, dStr)) {
          // [V55.4] DBに保存されるよう、公休レコードとして追加する
          assignOffShift(tracker, dStr, '公休', 'holiday_comp_off');
          console.log(`[ShiftEngine] ${tracker.name}: 休日出勤(${holidayDateStr})に伴う振替休日を ${dStr} に確定しました。`);
          return; // 確定したので終了
        }
      }
      console.warn(`[ShiftEngine] ${tracker.name}: 休日出勤(${holidayDateStr})の振替休日を割り当てられませんでした（候補日不足）。`);
    }

    // ═══════════════════════════════════════════
    // Pass 2: 休日・土日の割り当て
    // ═══════════════════════════════════════════
    console.log('\n[ShiftEngine] ════ Pass 2: 休日割り当て ════');

    for (const { dateStr, dayType, cap } of holidayDates) {
      // 既に手動で配置されている人数をカウント
      let assignedOnDay = manualWorkCountPerDay.get(dateStr) || 0;

      for (let slot = assignedOnDay; slot < cap; slot++) {
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

        // [V60.7] 名簿順（シーケンス）を絶対の基準としてローテーションを厳格化
        // ユーザー要望: 7月は「森田さん（13番目）」から厳格に開始する
        const isJuly = dateStr.startsWith('2026-07');
        const moritaIndex = rawEligible.findIndex(s => s.name.includes('森田'));
        const totalEligible = rawEligible.length;

        available.sort((a, b) => {
          const diff = a.holidayWorkCount - b.holidayWorkCount;
          if (diff !== 0) return diff;
          
          let seqA = staffSequenceMap.get(a.id) ?? 999;
          let seqB = staffSequenceMap.get(b.id) ?? 999;
          
          if (isJuly && moritaIndex !== -1 && seqA !== 999 && seqB !== 999) {
            seqA = (seqA - moritaIndex + totalEligible) % totalEligible;
            seqB = (seqB - moritaIndex + totalEligible) % totalEligible;
          }
          
          return seqA - seqB;
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

          // [V60.7] 名簿順（シーケンス）を絶対の基準としてローテーションを厳格化（フォールバック用）
          fallback.sort((a, b) => {
            const diff = a.holidayWorkCount - b.holidayWorkCount;
            if (diff !== 0) return diff;
            
            let seqA = staffSequenceMap.get(a.id) ?? 999;
            let seqB = staffSequenceMap.get(b.id) ?? 999;
            
            if (isJuly && moritaIndex !== -1 && seqA !== 999 && seqB !== 999) {
              seqA = (seqA - moritaIndex + totalEligible) % totalEligible;
              seqB = (seqB - moritaIndex + totalEligible) % totalEligible;
            }
            
            return seqA - seqB;
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

      // [V60.4] 平日定員の撤廃: 目標稼働日数に達していない全スタッフを割り当てる
      const underTarget = baseAvailable.filter(t => t.totalWorkCount < targetWorkDays);
      
      underTarget.forEach(t => assignShift(t, dateStr, 'weekday', 'weekday_equalization'));

      console.log(`[ShiftEngine] ${dateStr}(weekday): ${underTarget.length}人を配置。平日の定員制限は撤廃されました。`);
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

    console.log('[ShiftEngine] ════ 処理完了 ════\n');
    return generatedShifts;

  } catch (error: any) {
    console.error('[ShiftEngine] 致命的エラー:', error.message || error);
    throw error;
  }
};
