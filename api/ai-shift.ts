export const config = { maxDuration: 60 };

const toDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isWorkingType = (type: string) => {
  if (!type) return false;
  const t = String(type);
  // 全ての「出勤」および「勤務」を含むタイプ、および午前休・午後休を勤務日としてカウント
  return t.includes('出勤') || t.includes('日勤') || t.includes('通常') || t.includes('午前休') || t.includes('午後休');
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
      weekday: limits?.weekday ?? 10,
      sat: limits?.saturday ?? limits?.sat ?? 2,
      sun: limits?.sunday ?? limits?.sun ?? 2,
      pub: limits?.publicHoliday ?? limits?.public ?? limits?.pub ?? 2,
    };

    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const currentRequests = (requests || []).filter((r: any) => 
      r.date?.startsWith(monthPrefix) && 
      r.status === 'approved' &&
      !String(r.id || '').startsWith('af') &&
      !String(r.id || '').startsWith('ah') &&
      !String(r.id || '').startsWith('aw')
    );

    const prevMonthDate = new Date(year, month - 1, 1);
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

    const lastDay = new Date(year, month + 1, 0).getDate();
    const schedule: { [date: string]: { type: string, limit: number } } = {};
    const weekdays: string[] = [];
    const holidays: string[] = [];

    for (let i = 1; i <= lastDay; i++) {
      const d = new Date(year, month, i);
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

      schedule[dateStr] = { type, limit: lim };
      if (type === 'weekday') weekdays.push(dateStr);
      else holidays.push(dateStr);
    }

    const autoAssigned: any[] = [];
    const staffWorkDays: { [id: string]: Set<string> } = {};
    const staffHolidayWorkCount: { [id: string]: number } = {};

    const normalize = (name: string) => String(name || '').replace(/\s+/g, '');

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
      
      // Merge current and previous works into a single Set for accurate cross-month consecutive days checking
      staffWorkDays[sId] = new Set([...works, ...prevWorks]);
      const currentHolidays = works.filter((dStr: string) => holidays.includes(dStr)).length;

      // 今月分を優先して平準化するため、初期値は今月の手動分のみとする
      staffHolidayWorkCount[sId] = currentHolidays;
    });

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

      // 土日連続勤務を避けるためのチェック
      const hasAdjacent = adjacentStr ? (staffWorkDays[sId].has(adjacentStr) || 
                       autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === adjacentStr)) : false;
      
      // 同じ人が同じ月に二回休日出勤することも原則避けるためフラグを返す
      const alreadyWorkedHoliday = staffHolidayWorkCount[sId] > 0;
      
      return { hasAdjacent, alreadyWorkedHoliday };
    };

    for (const dStr of holidays) {
      const config = schedule[dStr];
      if (config.limit <= 0) continue;

      let occupants = currentRequests.filter((r: any) => r.date === dStr && isWorkingType(r.type)).length;
      let remaining = config.limit - occupants;

      for (let i = 0; i < remaining; i++) {
        const candidates = (staffList || [])
          .filter((s: any) => {
            const sId = String(s.id || s.name);
            const sName = normalize(s.name);
            const isUnavailable = s.status === '長期休暇' || s.status === '入職前' || s.isApproved === false;
            const isNoHoliday = s.noHoliday === true;
            const alreadyAssigned = staffWorkDays[sId].has(dStr) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr);
            const isOff = currentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type));
            const isExceeding = wouldExceedConsecutive(dStr, staffWorkDays[sId], 5);
            
            // 重要: 休日は必ず埋めるが、5連勤制限（厳守）と休み希望は守る
            return !isUnavailable && !alreadyAssigned && !isOff && !isNoHoliday && !isExceeding;
          })
          .sort((a: any, b: any) => {
            const aId = String(a.id || a.name);
            const bId = String(b.id || b.name);
            const aName = normalize(a.name);
            const bName = normalize(b.name);
            
            const aStat = getHolidayPenaltyInfo(aId, aName, dStr);
            const bStat = getHolidayPenaltyInfo(bId, bName, dStr);
            
            // 優先順位: 
            // 1. 今月の休日出勤回数が少ない人を最優先 (1回目が全員に回るまで2回目は選ばれない)
            // 2. 土日連続勤務（隣接）にならない人を優先
            const aPenalty = aStat.hasAdjacent ? 100 : 0;
            const bPenalty = bStat.hasAdjacent ? 100 : 0;
            
            if (staffHolidayWorkCount[aId] !== staffHolidayWorkCount[bId]) {
              return staffHolidayWorkCount[aId] - staffHolidayWorkCount[bId];
            }
            return aPenalty - bPenalty;
          });

        if (candidates.length > 0) {
          const chosen = candidates[0];
          const cId = String(chosen.id || chosen.name);
          autoAssigned.push({ staffId: cId, staffName: chosen.name, date: dStr, type: '出勤', details: { note: '自動割当(休日)' } });
          staffWorkDays[cId].add(dStr);
          staffHolidayWorkCount[cId]++;

          // 振替休日（シフト休）を平日にばらけさせる
          const wkday = [...weekdays].sort((a, b) => {
            const aOffs = autoAssigned.filter(x => x.date === a && x.type === 'シフト休').length;
            const bOffs = autoAssigned.filter(x => x.date === b && x.type === 'シフト休').length;
            return aOffs - bOffs; // 振替休日が少ない日を優先
          }).find(wd => {
            const lim = schedule[wd].limit;
            const wId = String(chosen.id || chosen.name);
            const wName = normalize(chosen.name);
            return lim > 0 && !staffWorkDays[wId].has(wd) && !autoAssigned.some(a => (String(a.staffId) === wId || normalize(a.staffName) === wName) && a.date === wd);
          });

          if (wkday) {
            autoAssigned.push({ staffId: cId, staffName: chosen.name, date: wkday, type: 'シフト休', details: { note: '休日振替' } });
          }
        }
      }
    }

    for (const dStr of weekdays) {
      const config = schedule[dStr];
      const targetLim = config.limit;

      // 平日は「目安」なので、リミットが多少前後しても全体の出勤数を平均化することを優先
      let occupants = currentRequests.filter((r: any) => r.date === dStr && isWorkingType(r.type)).length + 
                      autoAssigned.filter(a => a.date === dStr && isWorkingType(a.type)).length;
      
      // 平均化を優先するため、リミットの ±1 程度は許容して割り当てる
      let remaining = targetLim - occupants;

      for (let i = 0; i < remaining; i++) {
        const candidates = (staffList || [])
          .filter((s: any) => {
            const sId = String(s.id || s.name);
            const sName = normalize(s.name);
            const isUnavailable = s.status === '長期休暇' || s.status === '入職前' || s.isApproved === false;
            const alreadyAssigned = staffWorkDays[sId].has(dStr) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr);
            const isOff = currentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type)) ||
                          autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr && a.type === 'シフト休');
            
            // 平日は無理に連続勤務をさせず、他者に割り振る余地を残す
            return !isUnavailable && !alreadyAssigned && !isOff && !wouldExceedConsecutive(dStr, staffWorkDays[sId]);
          })
          .sort((a: any, b: any) => {
             const aId = String(a.id || a.name);
             const bId = String(b.id || b.name);
             // 全体の出勤日数が少ない人を優先して「平均化」する
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
    return res.status(500).json({ error: e.message });
  }
}

