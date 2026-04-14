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
  return n;
};

const isWorkingType = (type: string) => {
  if (!type) return false;
  const t = String(type);
  const workingTerms = ['出勤', '日勤', '勤務', '通常', '午前休', '午後休', '午前振替', '午後振替', '時間休', '特休', '看護休暇'];
  return workingTerms.some(term => t.includes(term));
};

const isManualRecord = (r: any) => {
  if (!r) return false;
  const idStr = String(r.id || '');
  const type = String(r.type || '').trim();
  const note = String(r.details?.note || '').trim();
  const reason = String(r.reason || '').trim();

  // 1. ID接頭辞による判定
  if (idStr.startsWith('m-') || idStr.startsWith('manual-')) return true;

  // 2. 振替・休暇・休業系の種別は一律手動扱い
  const leaveTypes = ['年休', '有給', '時間', '振替', '公休', '夏季', '特休', '休暇', '欠勤', '休'];
  if (leaveTypes.some(lt => type.includes(lt))) return true;

  // 3. isManualフラグの確認
  if (r.isManual === true || r.details?.isManual === true) return true;

  // 4. 明示的なロック
  if (r.details?.locked === true) return true;

  // 5. auto- で始まっていても、内容が人間によって書き換えられている場合は手動扱い
  if (idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-')) {
    // 備考や理由に「自動」というキーワードが含まれていれば自動
    if (note.includes('自動') || reason.includes('自動')) return false;
    // 備考も理由も空なら、AIが生成した直後とみなして自動扱い
    if (note === '' && reason === '') return false;
    // それ以外（人間が何か書いた等）は手動扱い
    return true;
  }

  // デフォルトは手動（安全側に倒す）
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
  '藤森渓',
  '佐藤晃',
  '久保田',
  '大沼',
  '辻',
  '南条',
  '小笠原',
  '坂下',
  '中野',
  '山川',
  '佐久間',
  '森田',
  '佐藤公貴',
  '吉田',
  '三井',
  '阿部'
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
    const schedule: { [date: string]: { type: string, limit: number } } = {};
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

      schedule[dateStr] = { type, limit: Number(lim) };
      if (type === 'weekday') weekdays.push(dateStr);
      else holidays.push(dateStr);
    }

    let autoAssigned: any[] = [];
    const staffWorkDays: { [id: string]: Set<string> } = {};
    const staffCurrentWorkCount: { [id: string]: number } = {};
    const staffHolidayWorkCount: { [id: string]: number } = {};

    const staffMap = new Map();
    (staffList || []).forEach((s: any) => {
      const sId = String(s.id || s.name);
      staffMap.set(sId, s);
      staffMap.set(normalize(s.name), s);
    });

    (staffList || []).forEach((s: any) => {
      const sId = String(s.id || s.name);
      const sName = normalize(s.name);

      const works = allCurrentRequests.filter((r: any) => {
        const match = String(r.staffId) === sId || normalize(r.staffName) === sName;
        return match && isWorkingType(r.type);
      }).map((r: any) => r.date);

      const prevWorks = allPrevRequests.filter((r: any) => {
        const match = String(r.staffId) === sId || normalize(r.staffName) === sName;
        return match && isWorkingType(r.type);
      }).map((r: any) => r.date);

      staffWorkDays[sId] = new Set([...works, ...prevWorks]);
      staffCurrentWorkCount[sId] = works.length;
      const currentHolidays = works.filter((dStr: string) => holidays.includes(dStr)).length;
      staffHolidayWorkCount[sId] = currentHolidays;
    });

    const dailyOccupants = new Map();
    const allDays = [...holidays, ...weekdays];
    allDays.forEach(dStr => {
      const count = allCurrentRequests.filter((r: any) => {
        if (r.date !== dStr || !isWorkingType(r.type)) return false;
        return true;
      }).length;
      dailyOccupants.set(dStr, count);
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
        const isHomeVisit = s.placement === '訪問';
        const isUnavailable = s.status === '長期休暇' || s.status === '入職前';
        const isNoHolidayValue = s.noHoliday ?? s.no_holiday;
        const isNoHoliday = isNoHolidayValue === true || isNoHolidayValue === 'true' || isNoHolidayValue === 1 || isNoHolidayValue === '1';
        return !isAssistant && !isHomeVisit && !isUnavailable && !isNoHoliday;
      })
      .sort((a: any, b: any) => {
        const aId = String(a.id || a.name);
        const bId = String(b.id || b.name);
        // 休日出勤数が少ないスタッフを優先
        const diff = (staffHolidayWorkCount[aId] || 0) - (staffHolidayWorkCount[bId] || 0);
        if (diff !== 0) return diff;
        // 同数の場合はランダム性を持たせる（または優先順位リスト）
        const pA = PREFERRED_ORDER.indexOf(normalize(a.name));
        const pB = PREFERRED_ORDER.indexOf(normalize(b.name));
        return (pA === -1 ? 99 : pA) - (pB === -1 ? 99 : pB);
      });

    // 1. 休日（土日祝）の割り当て
    for (const dStr of holidays) {
      const config = schedule[dStr];
      if (!config || config.limit <= 0) continue;

      const occupants = dailyOccupants.get(dStr) || 0;
      const remaining = config.limit - occupants;

      // Conflict Group メンバがいずれも出勤していない場合は優先的に割り当てる
      const currentWorkers = new Set(
        allCurrentRequests
          .filter((r: any) => r.date === dStr && isWorkingType(r.type))
          .map(r => normalize(r.staffName))
      );
      autoAssigned.forEach(a => {
        if (a.date === dStr && isWorkingType(a.type)) {
          currentWorkers.add(normalize(a.staffName));
        }
      });

      for (let i = 0; i < remaining; i++) {
        // 動的に優先度を再計算（出勤数が少ないスタッフを前に）
        holidayQueue.sort((a, b) => {
          const aId = String(a.id || a.name);
          const bId = String(b.id || b.name);
          const diff = (staffHolidayWorkCount[aId] || 0) - (staffHolidayWorkCount[bId] || 0);
          if (diff !== 0) return diff;
          const pA = PREFERRED_ORDER.indexOf(normalize(a.name));
          const pB = PREFERRED_ORDER.indexOf(normalize(b.name));
          return (pA === -1 ? 99 : pA) - (pB === -1 ? 99 : pB);
        });

        let chosenIdx = -1;

        // 0次検索: 特定の組合せ（久保田・佐久間など）が全員休みにならないように優先割り当て
        for (const group of CONFLICT_GROUPS) {
          const normalizedGroup = group.map(normalize);
          const anyoneWorking = normalizedGroup.some(name => currentWorkers.has(name));
          
          if (!anyoneWorking) {
            // このグループの誰かを出勤させたい
            for (let q = 0; q < holidayQueue.length; q++) {
              const s = holidayQueue[q];
              const sName = normalize(s.name);
              if (!normalizedGroup.includes(sName)) continue;

              const sId = String(s.id || s.name);
              const isAssistant = s.profession === '助手' || s.placement === '助手';
              const isHomeVisit = s.placement === '訪問';
              const isUnavailable = s.status === '長期休暇' || s.status === '入職前';
              const isNoHolidayValue = s.noHoliday ?? s.no_holiday;
              const isNoHoliday = isNoHolidayValue === true || isNoHolidayValue === 'true' || isNoHolidayValue === 1 || isNoHolidayValue === '1';

              if (isAssistant || isHomeVisit || isUnavailable || isNoHoliday) continue;

              const alreadyAssigned = staffWorkDays[sId]?.has(dStr) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr);
              const isOff = allCurrentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type));

              if (alreadyAssigned || isOff) continue;
              if (wouldExceedConsecutive(dStr, staffWorkDays[sId] || new Set(), 5)) continue;

              chosenIdx = q;
              break;
            }
          }
          if (chosenIdx !== -1) break;
        }

        // 1次検索: 同週連続・2週連続ともに避ける
        if (chosenIdx === -1) {
          for (let q = 0; q < holidayQueue.length; q++) {
          const s = holidayQueue[q];
          const sId = String(s.id || s.name);
          const sName = normalize(s.name);

          const isAssistant = s.profession === '助手' || s.placement === '助手';
          const isHomeVisit = s.placement === '訪問';
          const isUnavailable = s.status === '長期休暇' || s.status === '入職前';
          const isNoHolidayValue = s.noHoliday ?? s.no_holiday;
          const isNoHoliday = isNoHolidayValue === true || isNoHolidayValue === 'true' || isNoHolidayValue === 1 || isNoHolidayValue === '1';

          if (isAssistant || isHomeVisit || isUnavailable || isNoHoliday) continue;

          const alreadyAssigned = staffWorkDays[sId]?.has(dStr) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr);
          const isOff = allCurrentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type));

          if (alreadyAssigned || isOff) continue;
          if (wouldExceedConsecutive(dStr, staffWorkDays[sId] || new Set(), 5)) continue;

          const { hasAdjacent, workedSameDayLastWeek } = getHolidayPenaltyInfo(sId, sName, dStr);
          if (hasAdjacent || workedSameDayLastWeek) continue;

          chosenIdx = q;
          break;
        }
      }

      // 2次検索: 2週連続は許容するが同週連続は避ける
      if (chosenIdx === -1) {
        for (let q = 0; q < holidayQueue.length; q++) {
            const s = holidayQueue[q];
            const sId = String(s.id || s.name);
            const sName = normalize(s.name);
            if (s.profession === '助手' || s.placement === '助手' || s.placement === '訪問' || s.status === '長期休暇' || s.status === '入職前') continue;
            const isNoHolidayValue = s.noHoliday ?? s.no_holiday;
            const isNoHoliday = isNoHolidayValue === true || isNoHolidayValue === 'true' || isNoHolidayValue === 1 || isNoHolidayValue === '1';
            if (isNoHoliday) continue;

            if (staffWorkDays[sId]?.has(dStr) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr)) continue;
            if (allCurrentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type))) continue;
            if (wouldExceedConsecutive(dStr, staffWorkDays[sId] || new Set(), 5)) continue;

            const { hasAdjacent, workedSameDayLastWeek } = getHolidayPenaltyInfo(sId, sName, dStr);
            if (hasAdjacent && holidayQueue.length > 5) continue;
            if (workedSameDayLastWeek && holidayQueue.length > 8) continue;

            chosenIdx = q;
            break;
          }
        }

        if (chosenIdx !== -1) {
          const chosen = holidayQueue[chosenIdx];
          // Round-robinのローテーション（同数の場合のタイブレーカーとして機能）
          holidayQueue.splice(chosenIdx, 1);
          holidayQueue.push(chosen);

          const cId = String(chosen.id || chosen.name);
          const cKey = normalize(chosen.name);
          autoAssigned.push({ staffId: cId, staffName: chosen.name, date: dStr, type: '出勤', details: { note: '自動割当(休日)' } });
          currentWorkers.add(cKey);
          if (!staffWorkDays[cId]) staffWorkDays[cId] = new Set();
          staffWorkDays[cId].add(dStr);
          staffCurrentWorkCount[cId] = (staffCurrentWorkCount[cId] || 0) + 1;
          staffHolidayWorkCount[cId] = (staffHolidayWorkCount[cId] || 0) + 1;

          // 2. 振替公休（平日）の付与 - 同週優先、公休が重複しないよう分散
          const bestWkday = [...weekdays].filter(wd => {
            const hasJob = staffWorkDays[cId].has(wd) || allCurrentRequests.some((r: any) => r.date === wd && (String(r.staffId) === cId || normalize(r.staffName) === cKey));
            const hasAutoOff = autoAssigned.some(a => (String(a.staffId) === cId || normalize(a.staffName) === cKey) && a.date === wd && a.type === '公休');
            return !hasJob && !hasAutoOff;
          }).sort((a, b) => {
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

            // 公休が被らないよう、その日の公休数が少ない日を優先
            const aOffs = autoAssigned.filter(x => x.date === a && x.type === '公休');
            const bOffs = autoAssigned.filter(x => x.date === b && x.type === '公休');
            
            // CONFLICT_GROUPSのチェック: 同じグループの人が既にその日に公休になっている場合は避ける
            const getConflictScore = (dateStr: string) => {
              let score = 0;
              const offStaffNames = new Set(autoAssigned.filter(x => x.date === dateStr && x.type === '公休').map(x => normalize(x.staffName)));
              // 手動の公休も考慮
              allCurrentRequests.forEach((r: any) => {
                if (r.date === dateStr && !isWorkingType(r.type)) {
                  offStaffNames.add(normalize(r.staffName));
                }
              });

              for (const group of CONFLICT_GROUPS) {
                const normalizedGroup = group.map(normalize);
                if (normalizedGroup.includes(cKey)) {
                  const others = normalizedGroup.filter(name => name !== cKey);
                  if (others.some(other => offStaffNames.has(other))) {
                    score += 100; // 強いペナルティ
                  }
                }
              }
              return score;
            };

            const scoreA = aOffs.length + getConflictScore(a);
            const scoreB = bOffs.length + getConflictScore(b);
            if (scoreA !== scoreB) return scoreA - scoreB;

            // 週の中間を優先して連勤を分断
            const dowA = dateA.getDay();
            const dowB = dateB.getDay();
            const priority = [3, 4, 2, 1, 5]; // 水, 木, 火, 月, 金
            const dowScoreA = priority.indexOf(dowA);
            const dowScoreB = priority.indexOf(dowB);
            return dowScoreA - dowScoreB;
          })[0];

          if (bestWkday) {
            autoAssigned.push({ staffId: cId, staffName: chosen.name, date: bestWkday, type: '公休', details: { note: '休日振替' } });
          }
        }
      }
    }

    // 3. 平日の割り当て
    const targetWorkDays = weekdays.length;
    let keepAssigning = true;
    let iterations = 0;
    const maxIterations = weekdays.length * staffList.length * 2;

    while (keepAssigning && iterations < maxIterations) {
      keepAssigning = false;
      iterations++;

      const sortedWeekdays = [...weekdays].sort((a, b) => {
        const aOcc = (dailyOccupants.get(a) || 0) + autoAssigned.filter(x => x.date === a && isWorkingType(x.type)).length;
        const bOcc = (dailyOccupants.get(b) || 0) + autoAssigned.filter(x => x.date === b && isWorkingType(x.type)).length;
        return aOcc - bOcc;
      });

      for (const dStr of sortedWeekdays) {
        const config = schedule[dStr];

        let candidates = (staffList || [])
          .filter((s: any) => {
            const sId = String(s.id || s.name);
            const sName = normalize(s.name);
            if (s.status === '長期休暇' || s.status === '入職前') return false;

            const alreadyAssigned = (staffWorkDays[sId]?.has(dStr)) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr && isWorkingType(a.type));
            if (alreadyAssigned) return false;

            const isOff = allCurrentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type)) ||
              autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr && a.type === '公休');
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
            const aId = String(a.id || a.name);
            const bId = String(b.id || b.name);
            return (staffCurrentWorkCount[aId] || 0) - (staffCurrentWorkCount[bId] || 0);
          });

        if (candidates.length > 0) {
          const chosen = candidates[0];
          const cId = String(chosen.id || chosen.name);
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
          const midIdx = Math.floor(s.length / 2);

          // 手動出勤がある日付のセット（allCurrentRequests から）
          const manualWorkDates = new Set(
            allCurrentRequests
              .filter((r: any) =>
                (String(r.staffId) === sId || normalize(r.staffName) === sName) &&
                isWorkingType(r.type)
              )
              .map((r: any) => r.date)
          );

          // 自動割当で出勤になっている日付のセット
          const autoWorkDates = new Set(
            autoAssigned
              .filter((a: any) =>
                (String(a.staffId) === sId || normalize(a.staffName) === sName) &&
                isWorkingType(a.type)
              )
              .map((a: any) => a.date)
          );

          // 候補選定：①auto出勤かつ平日 > ②auto出勤かつ土日 > ③手動出勤平日 > ④手動出勤土日
          let insertDate: string | null = null;
          let insertDateScore = -1; // 高いほど優先

          for (let offset = 0; offset < s.length; offset++) {
            for (const candidate of [s[midIdx + offset], s[midIdx - offset]]) {
              if (!candidate || offSet.has(candidate)) continue;
              const dow = new Date(candidate.replace(/-/g, '/')).getDay();
              const isWeekday = dow >= 1 && dow <= 5;
              const isAuto = autoWorkDates.has(candidate);
              const isManual = manualWorkDates.has(candidate);
              // スコア: auto+平日=4, auto+土日=3, manual+平日=2, manual+土日=1, 不明=0
              let score = 0;
              if (isAuto && isWeekday) score = 4;
              else if (isAuto && !isWeekday) score = 3;
              else if (isManual && isWeekday) score = 2;
              else if (isManual && !isWeekday) score = 1;
              else if (isWeekday) score = 2; // 手動でも自動でもない平日
              else score = 0;

              if (score > insertDateScore) {
                insertDate = candidate;
                insertDateScore = score;
                if (score === 4) break; // 最高スコアなら即確定
              }
            }
            if (insertDateScore === 4) break;
          }

        if (insertDate) {
          // autoAssigned から該当スタッフの該当日の出勤レコードをすべて削除（重複除去を兼ねる）
          const beforeCount = autoAssigned.length;
          autoAssigned = autoAssigned.filter(
            (a: any) => !( (String(a.staffId) === sId || normalize(a.staffName) === sName)
              && a.date === insertDate
              && isWorkingType(a.type) )
          );
          
          if (autoAssigned.length < beforeCount) {
            console.log(`POST-PROCESS: remove auto work record(s) for ${staff.name} on ${insertDate}`);
          }

          // 手動出勤のある日に公休を挿入する場合は overrideManual フラグを立てる
          const hasManualWork = manualWorkDates.has(insertDate);
          console.log(`POST-PROCESS: insert 公休 for ${staff.name} on ${insertDate} (streak=${s.length}, overrideManual=${hasManualWork})`);
          autoAssigned.push({
            staffId: sId,
            staffName: staff.name,
            date: insertDate,
            type: '公休',
            details: {
              note: '連勤調整(自動挿入)',
              isManual: false,
              locked: false,
              overrideManual: hasManualWork,
              priority: 99
            }
          });
          fixApplied = true;
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
