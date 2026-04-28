export const config = { maxDuration: 60 };

const toDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const normalize = (name: string) => {
  if (!name || typeof name !== 'string') return '';
  let n = name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');
  // 特定の短縮名や表記ゆれを正規化
  if (n === '佐藤公') return '佐藤公貴';
  if (n === '藤森') return '藤森渓';
  if (n === '三井') return '三井諒';
  if (n === '佐藤') return '佐藤晃'; // 佐藤晃氏をデフォルトの佐藤として扱う
  if (n === '馬淵') return '馬淵由貴子'; 
  if (n === '吉田誠') return '吉田'; // 吉田誠氏は「吉田」として扱う
  return n;
};

const isWorking = (t: string) => {
  const workingTerms = ['出勤', '日勤', '勤務', '通常', '公休', '午前休', '午後休', '午前振替', '午後振替', '時間休', '特休', '看護休暇'];
  return workingTerms.some(term => t.includes(term));
};

const isWorkingType = isWorking;

const isManualRecord = (r: any) => {
  if (!r) return false;
  // Supabase から取得する際はスネークケース、アプリ内ではキャメルケースが混在するため両方チェック
  const idStr = String(r.id || '');
  const type = String(r.type || r.shift_type || '').trim();
  const note = String(r.details?.note || r.note || '').trim();
  const reason = String(r.reason || '').trim();
  const staffName = normalize(r.staff_name || r.staffName || '');

  // 1. ID接頭辞による判定 (m-, manual-, off- は手動)
  if (idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('off-')) return true;

  // 2. isManual / locked フラグの確認 (最優先)
  const isManualFlag = r.isManual === true || r.details?.isManual === true || r.is_manual === true;
  const isLockedFlag = r.locked === true || r.details?.locked === true;
  if (isManualFlag || isLockedFlag) return true;

  // 3. 有給などの特定の型は常に手動扱い
  const leaveTypes = ['年休', '有給', '夏季', '休暇', '欠勤', '休業'];
  if (leaveTypes.some(lt => type.includes(lt))) return true;

  // 4. 自動生成系IDであっても、種別が極めて例外的な場合や人間が編集した形跡があれば手動扱い
  const isAutoId = idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-');
  if (isAutoId) {
    // 振替系は基本的に人間が指定するもの
    if (type.includes('振替')) return true;
    
    // 備考や理由に「自動」以外の文字列が含まれていれば手動編集とみなす
    const hasHumanNote = note !== '' && !note.includes('自動');
    const hasHumanReason = reason !== '' && !reason.includes('自動');
    if (hasHumanNote || hasHumanReason) return true;
    
    // それ以外（人間が触っていない自動レコード）は自動として扱う
    return false;
  }

  // 5. 振替や公休は、自動生成でない（上のisAutoIdを通過した）限り手動扱い
  if (type.includes('振替') || type.includes('公休')) return true;

  return true;
};


const wouldExceedConsecutive = (date: string, workDays: Set<string>, max = 5): boolean => {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  let before = 0;
  for (let i = 1; i <= max; i++) {
    const prev = new Date(target);
    prev.setDate(target.getDate() - i);
    if (workDays.has(toDateStr(prev))) before++; else break;
  }
  let after = 0;
  for (let i = 1; i <= max; i++) {
    const next = new Date(target);
    next.setDate(target.getDate() + i);
    if (workDays.has(toDateStr(next))) after++; else break;
  }
  return (before + after + 1) > max;
};

const JAPAN_HOLIDAYS_SET = new Set([
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
  '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
  '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
  '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19',
  '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23'
]);

// ユーザー指定の優先順位リスト（同条件の場合のタイブレーカー）
const PREFERRED_ORDER = [
  '吉田',
  '佐藤公貴',
  '佐藤晃',
  '三井諒',
  '阿部',
  '藤森渓',
  '坂下',
  '佐久間',
  '中野',
  '山川',
  '久保田',
  '小笠原',
  '森田',
  '駒津',
  '馬淵由貴子'
];

// 特定のスタッフペア（例：久保田と佐久間）が同じ日に公休（休み）にならないように制限するためのグループ定義
const CONFLICT_GROUPS = [
  ['久保田', '佐久間']
];

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { staffList, requests, limits, month, year } = req.body;
  console.log('AI Shift Triggered:', { month, year, staffCount: staffList?.length, reqCount: requests?.length });

  try {
    const lims = {
      weekday: Number(limits?.weekday ?? 10),
      sat: Number(limits?.saturday ?? limits?.sat ?? 2),
      sun: Number(limits?.sunday ?? limits?.sun ?? 2),
      pub: Number(limits?.publicHoliday ?? limits?.public ?? limits?.pub ?? 2),
    };

    const jsMonth = Number(month) - 1;
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

    // 当月の全承認データ（重複排除の対象とするため、自動も含む）
    const allCurrentRequests = (requests || []).filter((r: any) =>
      r.date?.startsWith(monthPrefix) &&
      r.status === 'approved'
    );

    // 手動データのみのサブセット（制約として扱うため）
    const manualRequests = allCurrentRequests.filter(isManualRecord);

    const prevMonthDate = new Date(year, jsMonth - 1, 1);
    const prevMonthPrefix = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
    // 前月の全承認データ
    const allPrevRequests = (requests || []).filter((r: any) =>
      r.date?.startsWith(prevMonthPrefix) &&
      r.status === 'approved'
    );
    const manualPrevRequests = allPrevRequests.filter(isManualRecord);

    const isHolidayDate = (dateStr: string) => {
      if (JAPAN_HOLIDAYS_SET.has(dateStr)) return true;
      const dObj = new Date(dateStr.replace(/-/g, '/'));
      return dObj.getDay() === 0 || dObj.getDay() === 6;
    };

    const lastDay = new Date(year, jsMonth + 1, 0).getDate();
    const schedule: { [date: string]: { type: string, limit: number, originalLimit: number } } = {};
    const weekdays: string[] = [];
    const holidays: string[] = [];

    for (let i = 1; i <= lastDay; i++) {
      const d = new Date(`${year}/${String(jsMonth + 1).padStart(2, '0')}/${String(i).padStart(2, '0')}`);
      const dateStr = toDateStr(d);
      const dow = d.getDay();
      const isPub = JAPAN_HOLIDAYS_SET.has(dateStr);
      let type = 'weekday', lim = lims.weekday;

      if (dow === 0) {
        type = 'sun';
        lim = isPub ? Math.min(lims.sun, lims.pub) : lims.sun;
      } else if (dow === 6) {
        type = 'sat';
        lim = isPub ? Math.min(lims.sat, lims.pub) : lims.sat;
      } else if (isPub) {
        type = 'pub';
        lim = lims.pub;
      }

      schedule[dateStr] = { type, limit: Number(lim), originalLimit: Number(lim) };
      if (type === 'weekday') weekdays.push(dateStr);
      else holidays.push(dateStr);
    }

    let autoAssigned: any[] = [];
    const staffWorkDays: { [id: string]: Set<string> } = {};
    const staffCurrentWorkCount: { [id: string]: number } = {};
    const staffHolidayWorkCount: { [id: string]: number } = {};
    const dailyOccupants = new Map<string, number>();
    const idToStaff = new Map<string, any>();
    const nameToStaff = new Map<string, any>();
    (staffList || []).forEach((s: any) => {
      const realId = String(s.id || '');
      if (realId) idToStaff.set(realId, s);
      const normalizedName = normalize(s.name);
      if (normalizedName) nameToStaff.set(normalizedName, s);
    });

    const findStaff = (id: any, name: any) => {
      const sId = id ? String(id) : '';
      if (sId && idToStaff.has(sId)) return idToStaff.get(sId);
      const sName = normalize(name);
      if (sName && nameToStaff.has(sName)) return nameToStaff.get(sName);
      return null;
    };

    staffList.forEach((s: any) => {
      const sId = String(s.id);
      const works = allCurrentRequests.filter((r: any) => {
        const staff = findStaff(r.staffId, r.staffName);
        return staff && String(staff.id) === sId && isWorkingType(r.type);
      }).map((r: any) => r.date);

      staffWorkDays[sId] = new Set(works);
      staffCurrentWorkCount[sId] = works.length;
      
      const currentHolidays = works.filter((dStr: string) => holidays.includes(dStr)).length;
      staffHolidayWorkCount[sId] = currentHolidays;

      works.forEach(dStr => dailyOccupants.set(dStr, (dailyOccupants.get(dStr) || 0) + 1));
    });

    const allDays = [...holidays, ...weekdays];

    // 手動レコードを「既に埋まった枠」として先に staffWorkDays や dailyOccupants に反映させる
    manualRequests.forEach((r: any) => {
      const staff = findStaff(r.staffId, r.staffName);
      if (!staff) return;
      const realId = String(staff.id);
      
      if (!staffWorkDays[realId]) staffWorkDays[realId] = new Set();
      if (isWorkingType(r.type)) {
        staffWorkDays[realId].add(r.date);
        staffCurrentWorkCount[realId] = (staffCurrentWorkCount[realId] || 0) + 1;
        if (holidays.includes(r.date)) {
          staffHolidayWorkCount[realId] = (staffHolidayWorkCount[realId] || 0) + 1;
        }
        dailyOccupants.set(r.date, (dailyOccupants.get(r.date) || 0) + 1);
      }
    });

    // 既に手動で埋まっている分を除いた、各日の残り人数を確認
    allDays.forEach(dStr => {
      if (!dailyOccupants.has(dStr)) {
        dailyOccupants.set(dStr, 0);
      }
    });

    // 休日ペナルティ情報（同週連続 + 2週連続チェック）
    const getHolidayPenaltyInfo = (sId: string, sName: string, dateStr: string) => {
      const dObj = new Date(dateStr.replace(/-/g, '/'));
      const dow = dObj.getDay();

      let adjacentStr = '';
      if (dow === 0) {
        const sat = new Date(dObj); sat.setDate(sat.getDate() - 1);
        adjacentStr = toDateStr(sat);
      } else if (dow === 6) {
        const sun = new Date(dObj); sun.setDate(sun.getDate() + 1);
        adjacentStr = toDateStr(sun);
      }

      const hasAdjacent = adjacentStr ? (staffWorkDays[sId]?.has(adjacentStr) ||
        autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === adjacentStr)) : false;

      // 2週連続の同じ曜日チェック
      const lastWeek = new Date(dObj);
      lastWeek.setDate(lastWeek.getDate() - 7);
      const lastWeekStr = toDateStr(lastWeek);
      const workedSameDayLastWeek = staffWorkDays[sId]?.has(lastWeekStr) ||
        autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === lastWeekStr);

      const alreadyWorkedHoliday = (staffHolidayWorkCount[sId] || 0) > 0;
      return { hasAdjacent, workedSameDayLastWeek, alreadyWorkedHoliday };
    };

    const holidayQueue = (staffList || [])
      .filter((s: any) => {
        const isAssistant = s.profession === '助手' || s.placement === '助手';
        const isUnavailable = s.status === '長期休暇' || s.status === '入職前';
        const isNoHolidayValue = s.noHoliday ?? s.no_holiday;
        // [V55.1] 月ごとの個別設定を優先
        const isMonthlyNoHoliday = s.monthlyNoHoliday?.[monthPrefix] ?? s.monthly_no_holiday?.[monthPrefix];
        
        const isNoHoliday = isMonthlyNoHoliday ?? (isNoHolidayValue === true || isNoHolidayValue === 'true' || isNoHolidayValue === 1 || isNoHolidayValue === '1');
        return !isAssistant && !isUnavailable && !isNoHoliday;
      })
      .sort((a: any, b: any) => {
        const pA = PREFERRED_ORDER.indexOf(normalize(a.name));
        const pB = PREFERRED_ORDER.indexOf(normalize(b.name));
        
        // [V56.0] 7月の開始位置調整 (13番: 森田氏から開始)
        let offset = 0;
        if (Number(year) === 2026 && Number(month) === 7) {
            // 13番から開始 = 13番目以降の人を優先（先頭に持ってくる）
            // インデックス 12 (13番) を 0 とみなすようなソート
            const rotationIndex = 12; // 13番目
            const rotate = (idx: number) => {
                if (idx === -1) return 999;
                return (idx - rotationIndex + PREFERRED_ORDER.length) % PREFERRED_ORDER.length;
            };
            return rotate(pA) - rotate(pB);
        }

        return (pA === -1 ? 999 : pA) - (pB === -1 ? 999 : pB);
      });

    console.log("[Engine Debug] 休日出勤の候補者数 (土日祝休み設定のスタッフを除外後):", holidayQueue.length);
    console.log(`DEBUG: Holiday candidate names: ${holidayQueue.map((s: any) => s.name).join(', ')}`);

    // 1. 休日（土日祝）の割り当て
    for (const dStr of holidays) {
      const config = schedule[dStr];
      if (!config || config.limit <= 0) continue;

      const occupants = dailyOccupants.get(dStr) || 0;
      const remaining = config.limit - occupants;

      const currentWorkers = new Set(
        allCurrentRequests
          .filter((r: any) => r.date === dStr && isWorkingType(r.type))
          .map((r: any) => normalize(r.staffName))
      );
      autoAssigned.forEach(a => {
        if (a.date === dStr && isWorkingType(a.type)) {
          currentWorkers.add(normalize(a.staffName));
        }
      });

      for (let i = 0; i < remaining; i++) {
        let chosenIdx = -1;

        // 1次検索: 同週連続・2週連続・5日連続すべてを避ける (最優先の制約遵守)
        for (let q = 0; q < holidayQueue.length; q++) {
          const s = holidayQueue[q];
          const sId = String(s.id);
          const sName = normalize(s.name);
          const alreadyAssigned = staffWorkDays[sId]?.has(dStr) || autoAssigned.some(a => String(a.staffId) === sId && a.date === dStr);
          const isOff = allCurrentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type));

          if (alreadyAssigned || isOff) {
            console.log(`LOG [Skip 1]: ${s.name} is already ${alreadyAssigned ? 'assigned' : 'off'} on ${dStr}`);
            continue;
          }
          
          // 修正: 休日割当時は連勤制限によるスキップをしない (ローテーション優先)
          // ポストプロセスで平日に公休を入れて解決する

          // 修正: 7月度は順番を最優先するため、ペナルティチェックをスキップ
          const isJuly2026 = Number(year) === 2026 && Number(month) === 7;
          if (!isJuly2026) {
            const { hasAdjacent, workedSameDayLastWeek } = getHolidayPenaltyInfo(sId, sName, dStr);
            if (hasAdjacent || workedSameDayLastWeek) continue;
          }

          chosenIdx = q;
          break;
        }

        // 2次検索: 2週連続は許容するが、同週連続と5日連続は避ける
        if (chosenIdx === -1) {
          for (let q = 0; q < holidayQueue.length; q++) {
            const s = holidayQueue[q];
            const sId = String(s.id);
            const sName = normalize(s.name);
            const alreadyAssigned = staffWorkDays[sId]?.has(dStr) || autoAssigned.some(a => String(a.staffId) === sId && a.date === dStr);
            const isOff = allCurrentRequests.some((r: any) => {
              const staff = findStaff(r.staffId, r.staffName);
              return staff && String(staff.id) === sId && r.date === dStr && !isWorkingType(r.type);
            });

            if (alreadyAssigned || isOff) continue;
            // 連勤制限はスキップしない

            const { hasAdjacent } = getHolidayPenaltyInfo(sId, sName, dStr);
            if (hasAdjacent && holidayQueue.length > 5) continue;

            chosenIdx = q;
            break;
          }
        }

        // 3次検索: 5日連続を避けつつ、他の制約は無視して順番を優先
        if (chosenIdx === -1) {
          for (let q = 0; q < holidayQueue.length; q++) {
            const s = holidayQueue[q];
            const sId = String(s.id);
            const sName = normalize(s.name);
            const alreadyAssigned = staffWorkDays[sId]?.has(dStr) || autoAssigned.some(a => String(a.staffId) === sId && a.date === dStr);
            const isOff = allCurrentRequests.some((r: any) => {
              const staff = findStaff(r.staffId, r.staffName);
              return staff && String(staff.id) === sId && r.date === dStr && !isWorkingType(r.type);
            });
            
            if (alreadyAssigned || isOff) continue;
            // 連勤制限はスキップしない

            chosenIdx = q;
            break;
          }
        }

        // 最終手段: 5日連続すら無視して、休みでない人を順番に割り当て
        if (chosenIdx === -1) {
          for (let q = 0; q < holidayQueue.length; q++) {
            const s = holidayQueue[q];
            const sId = String(s.id);
            const sName = normalize(s.name);
            if (staffWorkDays[sId]?.has(dStr) || autoAssigned.some(a => String(a.staffId) === sId && a.date === dStr)) continue;
            if (allCurrentRequests.some((r: any) => {
              const staff = findStaff(r.staffId, r.staffName);
              return staff && String(staff.id) === sId && r.date === dStr && !isWorkingType(r.type);
            })) continue;
            chosenIdx = q;
            break;
          }
        }

        if (chosenIdx !== -1) {
          const chosen = holidayQueue[chosenIdx];
          holidayQueue.splice(chosenIdx, 1);
          holidayQueue.push(chosen);

          const cId = String(chosen.id);
          const cKey = normalize(chosen.name);
          console.log(`DEBUG: Assigning ${chosen.name} to ${dStr}`);
          // 修正: ID体系を統一
          autoAssigned.push({ 
            id: `auto-${cId}-${dStr}`,
            staffId: cId, 
            staffName: chosen.name, 
            date: dStr, 
            type: '出勤', 
            details: { note: '自動割当(休日)' } 
          });
          currentWorkers.add(cKey);
          if (!staffWorkDays[cId]) staffWorkDays[cId] = new Set();
          staffWorkDays[cId].add(dStr);
          staffCurrentWorkCount[cId] = (staffCurrentWorkCount[cId] || 0) + 1;
          staffHolidayWorkCount[cId] = (staffHolidayWorkCount[cId] || 0) + 1;
          dailyOccupants.set(dStr, (dailyOccupants.get(dStr) || 0) + 1); // 確実にカウントアップ

          // 2. 振替公休（平日）の付与 - 必須項目
          const sortedWeekdays = [...weekdays].sort((a, b) => {
            const dateA = new Date(a.replace(/-/g, '/'));
            const dateB = new Date(b.replace(/-/g, '/'));
            const targetD = new Date(dStr.replace(/-/g, '/'));

            const getWeek = (d: Date) => {
              const date = new Date(d.getTime());
              const day = date.getDay();
              const diff = date.getDate() - day + (day === 0 ? -6 : 1);
              return new Date(date.setDate(diff)).toDateString();
            };

            const isSameWeekA = getWeek(dateA) === getWeek(targetD);
            const isSameWeekB = getWeek(dateB) === getWeek(targetD);
            if (isSameWeekA && !isSameWeekB) return -1;
            if (!isSameWeekA && isSameWeekB) return 1;

            const aOffs = autoAssigned.filter(x => x.date === a && x.type === '公休');
            const bOffs = autoAssigned.filter(x => x.date === b && x.type === '公休');
            const scoreA = aOffs.length;
            const scoreB = bOffs.length;
            return scoreA - scoreB;
          });

          const bestWkday = sortedWeekdays.find(wd => {
            const hasJob = staffWorkDays[cId].has(wd) || allCurrentRequests.some((r: any) => r.date === wd && findStaff(r.staffId, r.staffName)?.id === cId);
            const hasAutoOff = autoAssigned.some(a => String(a.staffId) === cId && a.date === wd && a.type === '公休');
            return !hasJob && !hasAutoOff;
          });

          if (bestWkday) {
            autoAssigned.push({ staffId: cId, staffName: chosen.name, date: bestWkday, type: '公休', details: { note: '休日振替' } });
            // 平日側の occupants は減らさない（weekdayループで調整するため）
          }
        }
      }
    }

    // 3. 平日の割り当て - 柔軟な配分
    const targetWorkDays = weekdays.length;
    let keepAssigning = true;
    while (keepAssigning) {
      keepAssigning = false;
      for (const dStr of weekdays) {
        const config = schedule[dStr];
        const currentOcc = (dailyOccupants.get(dStr) || 0);
        if (currentOcc >= config.limit) continue;

        const candidates = staffList
          .filter((s: any) => {
            const sId = String(s.id);
            const sName = normalize(s.name);
            if (s.status === '長期休暇' || s.status === '入職前') return false;
            if (staffWorkDays[sId]?.has(dStr) || autoAssigned.some(a => String(a.staffId) === sId && a.date === dStr)) return false;

            const isOff = allCurrentRequests.some((r: any) => {
              const staff = findStaff(r.staffId, r.staffName);
              return staff && String(staff.id) === sId && r.date === dStr && !isWorkingType(r.type);
            }) || autoAssigned.some(a => String(a.staffId) === sId && a.date === dStr && a.type === '公休');
            if (isOff) return false;

            if ((staffCurrentWorkCount[sId] || 0) >= targetWorkDays) return false;

            // 公休日を考慮した実効出勤日セットで5連勤チェック
            const holidayDaysForStaff = new Set(
              autoAssigned
                .filter(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.type === '公休')
                .map(a => a.date)
            );
            const effectiveWorkDays = new Set(
              [...(staffWorkDays[sId] || new Set())].filter(day => !holidayDaysForStaff.has(day))
            );
            return !wouldExceedConsecutive(dStr, effectiveWorkDays, 5);
          })
          .sort((a: any, b: any) => {
            const aId = String(a.id);
            const bId = String(b.id);
            return (staffCurrentWorkCount[aId] || 0) - (staffCurrentWorkCount[bId] || 0);
          });

        if (candidates.length > 0) {
          const chosen = candidates[0];
          const cId = String(chosen.id);
          autoAssigned.push({ staffId: cId, staffName: chosen.name, date: dStr, type: '出勤', details: { note: '自動割当(平日)' } });
          if (!staffWorkDays[cId]) staffWorkDays[cId] = new Set();
          staffWorkDays[cId].add(dStr);
          staffCurrentWorkCount[cId] = (staffCurrentWorkCount[cId] || 0) + 1;
          keepAssigning = true;
          break;
        }
      }
    }

    // ─────────────────────────────────────────────────
    // 4. ポストプロセス: 全スタッフの連勤を検査し、5連勤超を強制的に公休で分断
    // ─────────────────────────────────────────────────
    for (const staff of (staffList || [])) {
      const sId = String(staff.id || staff.name);
      const sName = normalize(staff.name);

      const buildWorkAndOffSets = () => {
        const workSet = new Set<string>();
        const offSet = new Set<string>();

        // 前月のデータを追加（月跨ぎの連勤チェック用）
        allPrevRequests.forEach((r: any) => {
          if ((String(r.staffId) === sId || normalize(r.staffName) === sName)) {
            if (isWorkingType(r.type)) workSet.add(r.date);
            else offSet.add(r.date);
          }
        });

        allCurrentRequests.forEach((r: any) => {
          if ((String(r.staffId) === sId || normalize(r.staffName) === sName)) {
            if (isWorkingType(r.type)) workSet.add(r.date);
            else offSet.add(r.date);
          }
        });
        autoAssigned.forEach((a: any) => {
          if ((String(a.staffId) === sId || normalize(a.staffName) === sName)) {
            if (isWorkingType(a.type)) workSet.add(a.date);
            else if (a.type === '公休') offSet.add(a.date);
          }
        });
        return { workSet, offSet };
      };

      // 最大5回まで反復して全ての6連勤を解消する
      for (let pass = 0; pass < 5; pass++) {
        const { workSet, offSet } = buildWorkAndOffSets();
        const sortedWorkDates = [...workSet].filter(d => !offSet.has(d)).sort();

        let fixApplied = false;
        let streak: string[] = [];

        const tryFixStreak = (s: string[]) => {
          if (s.length <= 5) return;
          console.log(`STREAK_FIX: Detected ${s.length} days streak for ${staff.name}: ${s.join(',')}`);

          // 手動レコードがある日付を特定（絶対に削除・公休上書きできない日）
          const manualRecordDates = new Set(
            allCurrentRequests
              .filter((r: any) =>
                (String(r.staffId) === sId || normalize(r.staffName) === sName) &&
                isManualRecord(r)
              )
              .map((r: any) => r.date)
          );

          // 自動割り当ての出勤レコード
          const autoWorkDates = new Set(
            autoAssigned
              .filter((a: any) =>
                (String(a.staffId) === sId || normalize(a.staffName) === sName) &&
                isWorkingType(a.type)
              )
              .map((a: any) => a.date)
          );

          // 連勤の真ん中あたりで、最も公休にしやすくかつ手動データではない日を探す
          let insertDate: string | null = null;
          let bestScore = -1;
          const mid = Math.floor(s.length / 2);

          for (let offset = 0; offset <= mid; offset++) {
            const indices = offset === 0 ? [mid] : [mid + offset, mid - offset];
            for (const idx of indices) {
              const d = s[idx];
              if (!d) continue;

              // 手動データがある日は絶対に触らない
              if (manualRecordDates.has(d)) continue;

              let score = 0;
              const dow = new Date(d.replace(/-/g, '/')).getDay();
              const isWkday = dow >= 1 && dow <= 5;
              const isAuto = autoWorkDates.has(d);

              if (isAuto) {
                // 自動割り当ての平日出勤を公休に変えるのが最も安全
                if (isWkday) score = 10;
                else score = 8;
              } else {
                // 自動データがないが連勤に含まれている（通常あり得ないが）
                score = 5;
              }

              if (score > bestScore) {
                bestScore = score;
                insertDate = d;
              }
            }
            if (bestScore === 10) break; // 最適な平日が見つかれば終了
          }

          if (insertDate) {
            console.log(`STREAK_FIX: Fixing streak for ${staff.name} by inserting 公休 on ${insertDate}`);
            
            // 既存の自動出勤レコードを削除
            autoAssigned = autoAssigned.filter(a => 
              !( (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === insertDate && isWorkingType(a.type) )
            );

            // 公休を追加（予算に関わらず、5連勤制限遵守を優先）
            autoAssigned.push({
              staffId: sId,
              staffName: staff.name,
              date: insertDate,
              type: '公休',
              details: {
                note: '連勤調整(自動修正)',
                isManual: false,
                locked: false
              }
            });
            fixApplied = true;
          } else {
            console.error(`STREAK_FIX: Failed to find a valid day to break streak for ${staff.name} (all manual?)`);
          }
        };

        for (let i = 0; i < sortedWorkDates.length; i++) {
          const d = sortedWorkDates[i];
          if (streak.length === 0) {
            streak = [d];
          } else {
            const prev = new Date(streak[streak.length - 1].replace(/-/g, '/'));
            const curr = new Date(d.replace(/-/g, '/'));
            const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
              streak.push(d);
            } else {
              tryFixStreak(streak);
              streak = [d];
            }
          }
        }
        tryFixStreak(streak);

        if (!fixApplied) break; // 修正不要ならループ終了
      }
    }

    // ─────────────────────────────────────────────────
    // 5. 最終的な重複排除
    // ─────────────────────────────────────────────────
    const finalMap = new Map();
    autoAssigned.forEach(r => {
      const key = `${normalize(r.staffName)}-${r.date}-${r.type}`;
      finalMap.set(key, r);
    });

    return res.status(200).json({ newRequests: Array.from(finalMap.values()) });

  } catch (e: any) {
    console.error('AI Shift Error:', e);
    return res.status(500).json({ error: e.message });
  }
}
