export const config = { maxDuration: 60 };

const toDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isWorkingType = (type: string) => {
  if (!type) return false;
  const t = String(type);
  // 全ての「出勤」および「勤務」を含むタイプ、および午前休・午後休を出勤日としてカウント
  return t.includes('出勤') || t.includes('勤務') || t.includes('通常') || t.includes('午前休') || t.includes('午後休');
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
}

const JAPAN_HOLIDAYS_SET = new Set([
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
  '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
  '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  // --- 2027年 ---
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
  '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19',
  '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23'
]);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { staffList, requests, limits, month, year } = req.body;

  try {
    const lims = {
      weekday: Number(limits?.weekday ?? 10),
      sat: Number(limits?.saturday ?? limits?.sat ?? 2),
      sun: Number(limits?.sunday ?? limits?.sun ?? 2),
      pub: Number(limits?.publicHoliday ?? limits?.public ?? limits?.pub ?? 2),
    };

    // JSの月は0始まりのため、送られてきた1始まりの月を-1する
    const jsMonth = Number(month) - 1;
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const currentRequests = (requests || []).filter((r: any) => 
      r.date?.startsWith(monthPrefix) && 
      r.status === 'approved' &&
      !String(r.id || '').startsWith('auto-')
    );

    const prevMonthDate = new Date(year, jsMonth - 1, 1);
    const prevMonthPrefix = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const prevRequests = (requests || []).filter((r: any) => 
      r.date?.startsWith(prevMonthPrefix) && 
      r.status === 'approved'
    );

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
      // タイムゾーンの揺れを防ぐため YYYY/MM/DD 形式で生成
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

    const autoAssigned: any[] = [];
    const staffWorkDays: { [id: string]: Set<string> } = {};
    const staffHolidayWorkCount: { [id: string]: number } = {};

    const normalize = (name: string) => String(name || '').replace(/\s+/g, '');

    // 高速ルックアップ用のスタッフマップを作成
    const staffMap = new Map();
    (staffList || []).forEach(s => {
      const sId = String(s.id || s.name);
      staffMap.set(sId, s);
      staffMap.set(normalize(s.name), s);
    });

    (staffList || []).forEach((s: any) => {
      const sId = String(s.id || s.name);
      const sName = normalize(s.name);
      
      const works = currentRequests.filter((r: any) => {
         const match = String(r.staffId) === sId || normalize(r.staffName) === sName;
         return match && isWorkingType(r.type);
      }).map((r: any) => r.date);
      
      const prevWorks = prevRequests.filter((r: any) => {
         const match = String(r.staffId) === sId || normalize(r.staffName) === sName;
         return match && isWorkingType(r.type);
      }).map((r: any) => r.date);
      
      staffWorkDays[sId] = new Set([...works, ...prevWorks]);
      const currentHolidays = works.filter((dStr: string) => holidays.includes(dStr)).length;
      staffHolidayWorkCount[sId] = currentHolidays;
    });

    // 各日の「現場」出勤者数を事前計算（助手・訪問スタッフを除外）
    const dailyOccupants = new Map();
    for (const dStr of [...holidays, ...weekdays]) {
      const count = currentRequests.filter(r => {
        if (r.date !== dStr || !isWorkingType(r.type)) return false;
        const s = staffMap.get(String(r.staffId)) || staffMap.get(normalize(r.staffName));
        const isAssistant = s?.profession === '助手' || s?.placement === '助手';
        const isHomeVisit = s?.placement === '訪問';
        return !isAssistant && !isHomeVisit;
      }).length;
      dailyOccupants.set(dStr, count);
    }

    // 休日連続チェック関数
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

      const hasAdjacent = adjacentStr ? (staffWorkDays[sId].has(adjacentStr) || 
                       autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === adjacentStr)) : false;
      
      const alreadyWorkedHoliday = staffHolidayWorkCount[sId] > 0;
      return { hasAdjacent, alreadyWorkedHoliday };
    };

    // 1. 休日（土日祝）の割り当て
    for (const dStr of holidays) {
      const config = schedule[dStr];
      if (config.limit <= 0) continue;

      const occupants = dailyOccupants.get(dStr) || 0;
      let remaining = config.limit - occupants;

      for (let i = 0; i < remaining; i++) {
        const candidates = (staffList || [])
          .filter((s: any) => {
            const sId = String(s.id || s.name);
            const sName = normalize(s.name);
            const isAssistant = s.profession === '助手' || s.placement === '助手';
            const isHomeVisit = s.placement === '訪問';
            const isUnavailable = s.status === '長期休暇' || s.status === '入職前';
            const isNotApproved = s.isApproved === false;
            const isNoHolidayValue = s.noHoliday ?? s.no_holiday;
            const isNoHoliday = isNoHolidayValue === true || isNoHolidayValue === 'true' || isNoHolidayValue === 1 || isNoHolidayValue === '1';
            
            // 助手、訪問担当、長期休暇、未承認、休日出勤不可設定のスタッフを除外
            if (isAssistant || isHomeVisit || isUnavailable || isNotApproved || isNoHoliday) return false;

            const alreadyAssigned = staffWorkDays[sId].has(dStr) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr);
            const isOff = currentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type));
            
            if (alreadyAssigned || isOff) return false;

            return !wouldExceedConsecutive(dStr, staffWorkDays[sId], 5);
          })
          .sort((a: any, b: any) => {
            const aId = String(a.id || a.name);
            const bId = String(b.id || b.name);
            const aName = normalize(a.name);
            const bName = normalize(b.name);
            
            const aStat = getHolidayPenaltyInfo(aId, aName, dStr);
            const bStat = getHolidayPenaltyInfo(bId, bName, dStr);
            
            // 平準化優先（今月の休日出勤が少ない人）、次に土日連続出勤回避
            if (staffHolidayWorkCount[aId] !== staffHolidayWorkCount[bId]) {
              return staffHolidayWorkCount[aId] - staffHolidayWorkCount[bId];
            }
            const aPenalty = aStat.hasAdjacent ? 1 : 0;
            const bPenalty = bStat.hasAdjacent ? 1 : 0;
            return aPenalty - bPenalty;
          });

        if (candidates.length > 0) {
          const chosen = candidates[0];
          const cId = String(chosen.id || chosen.name);
          const cName = chosen.name;
          
          // 休日出勤を追加
          autoAssigned.push({ staffId: cId, staffName: cName, date: dStr, type: '出勤', details: { note: '自動割当(休日)' } });
          staffWorkDays[cId].add(dStr);
          staffHolidayWorkCount[cId]++;

          // 2. 振替公休（平日）の付与
          // 休日出勤した週か翌週の平日の中で、最も連勤を短縮できる日を選ぶ
          const bestWkday = [...weekdays].filter(wd => {
            const sT = normalize(cName);
            // 既に予定（申請または自動公休）がある日は除外
            const hasJob = staffWorkDays[cId].has(wd) || currentRequests.some(r => r.date === wd && (String(r.staffId) === cId || normalize(r.staffName) === sT));
            const hasAutoOff = autoAssigned.some(a => (String(a.staffId) === cId || normalize(a.staffName) === sT) && a.date === wd && a.type === '公休');
            return !hasJob && !hasAutoOff;
          }).sort((a, b) => {
            // 公休者が少ない日を優先して選ぶ（平日の稼働確保）
            const aOffs = autoAssigned.filter(x => x.date === a && x.type === '公休').length;
            const bOffs = autoAssigned.filter(x => x.date === b && x.type === '公休').length;
            return aOffs - bOffs;
          })[0];

          if (bestWkday) {
            autoAssigned.push({ staffId: cId, staffName: cName, date: bestWkday, type: '公休', details: { note: '休日振替' } });
            // staffWorkDays[cId] には追加しない（公休なので）
          }
        }
      }
    }

    // 3. 平日の割り当て（不足人数の補充と平準化）
    for (const dStr of weekdays) {
      const config = schedule[dStr];
      const targetLim = config.limit;
      if (targetLim <= 0) continue;

      const occupants = (dailyOccupants.get(dStr) || 0) + autoAssigned.filter(a => a.date === dStr && isWorkingType(a.type)).length;
      let remaining = targetLim - occupants;

      for (let i = 0; i < remaining; i++) {
        const candidates = (staffList || [])
          .filter((s: any) => {
            const sId = String(s.id || s.name);
            const sName = normalize(s.name);
            const isAssistant = s.profession === '助手' || s.placement === '助手';
            const isHomeVisit = s.placement === '訪問';
            const isUnavailable = s.status === '長期休暇' || s.status === '入職前' || s.isApproved === false;
            
            if (isAssistant || isHomeVisit || isUnavailable) return false;

            const alreadyAssigned = staffWorkDays[sId].has(dStr) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr);
            const isOff = currentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type)) ||
                          autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr && a.type === '公休');
            
            // 既に予定がある、休み、または振替公休なら除外。また5連勤制限を守る。
            return !alreadyAssigned && !isOff && !wouldExceedConsecutive(dStr, staffWorkDays[sId], 5);
          })
          .sort((a: any, b: any) => {
             const aId = String(a.id || a.name);
             const bId = String(b.id || b.name);
             // 今月の出勤日数が少ない人を優先して「平均化」する
             return staffWorkDays[aId].size - staffWorkDays[bId].size;
          });

        if (candidates.length > 0) {
          const chosen = candidates[0];
          const cId = String(chosen.id || chosen.name);
          autoAssigned.push({ staffId: cId, staffName: chosen.name, date: dStr, type: '出勤', details: { note: '自動割当(平日)' } });
          staffWorkDays[cId].add(dStr);
        }
      }
    }

    return res.status(200).json({ newRequests: autoAssigned });
  } catch (e: any) {
    console.error('AI Shift Error:', e);
    return res.status(500).json({ error: e.message });
  }
}


