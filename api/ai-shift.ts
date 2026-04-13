export const config = { maxDuration: 60 };

const toDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const normalize = (name: string) => {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');
};

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

// ユーザー指定の優先順位リスト（同条件の場合のタイブレーカー）
const PREFERRED_ORDER = [
  '藤森渓',
  '久保田',
  '大沼',
  '辻',
  '南条',
  '小笠原',
  '佐藤晃',
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
    const staffCurrentWorkCount: { [id: string]: number } = {};
    const staffHolidayWorkCount: { [id: string]: number } = {};

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
      staffCurrentWorkCount[sId] = works.length;
      const currentHolidays = works.filter((dStr: string) => holidays.includes(dStr)).length;
      staffHolidayWorkCount[sId] = currentHolidays;
    });

    // 各日の出勤者数を事前計算（全スタッフをカウント）
    const dailyOccupants = new Map();
    const allDays = [...holidays, ...weekdays];
    allDays.forEach(dStr => {
      const count = currentRequests.filter(r => {
        if (r.date !== dStr || !isWorkingType(r.type)) return false;
        return true; // 全員カウント
      }).length;
      dailyOccupants.set(dStr, count);
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

      const hasAdjacent = adjacentStr ? (staffWorkDays[sId]?.has(adjacentStr) || 
                       autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === adjacentStr)) : false;
      
      const alreadyWorkedHoliday = (staffHolidayWorkCount[sId] || 0) > 0;
      return { hasAdjacent, alreadyWorkedHoliday };
    };

    const holidayQueue: any[] = [];
    PREFERRED_ORDER.forEach(pName => {
      const s = (staffList || []).find((s: any) => normalize(s.name) === pName);
      if (s) holidayQueue.push(s);
    });
    (staffList || []).forEach((s: any) => {
      if (!holidayQueue.some(hq => String(hq.id || hq.name) === String(s.id || s.name))) holidayQueue.push(s);
    });

    // 1. 休日（土日祝）の割り当て
    for (const dStr of holidays) {
      const config = schedule[dStr];
      if (!config || config.limit <= 0) continue;

      const occupants = dailyOccupants.get(dStr) || 0;
      let remaining = config.limit - occupants;

      for (let i = 0; i < remaining; i++) {
        let chosenIdx = -1;
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
          const isOff = currentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type));
          
          if (alreadyAssigned || isOff) continue;
          if (wouldExceedConsecutive(dStr, staffWorkDays[sId] || new Set(), 5)) continue;
          
          // 前日・翌日に休日出勤がある場合は避ける（ただしどうしてもいない場合は無視するロジックだが、一旦厳格に避ける）
          const { hasAdjacent } = getHolidayPenaltyInfo(sId, sName, dStr);
          if (hasAdjacent) continue;
          
          chosenIdx = q;
          break;
        }

        // もし hasAdjacent の条件で全員弾かれて誰も見つからなかった場合、hasAdjacent を無視して再検索
        if (chosenIdx === -1) {
          for (let q = 0; q < holidayQueue.length; q++) {
            const s = holidayQueue[q];
            const sId = String(s.id || s.name);
            const sName = normalize(s.name);
            if (s.profession === '助手' || s.placement === '助手' || s.placement === '訪問' || s.status === '長期休暇' || s.status === '入職前') continue;
            const isNoHol = s.noHoliday ?? s.no_holiday;
            if (isNoHol === true || isNoHol === 'true' || isNoHol === 1 || isNoHol === '1') continue;
            
            if (staffWorkDays[sId]?.has(dStr) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr)) continue;
            if (currentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type))) continue;
            if (wouldExceedConsecutive(dStr, staffWorkDays[sId] || new Set(), 5)) continue;
            
            chosenIdx = q;
            break;
          }
        }

        if (chosenIdx !== -1) {
          const chosen = holidayQueue[chosenIdx];
          
          // 選ばれたスタッフをキューの最後尾に移動（順番・均等化を完全保証するラウンドロビン）
          holidayQueue.splice(chosenIdx, 1);
          holidayQueue.push(chosen);

          const cId = String(chosen.id || chosen.name);
          const cKey = normalize(chosen.name);
          autoAssigned.push({ staffId: cId, staffName: chosen.name, date: dStr, type: '出勤', details: { note: '自動割当(休日)' } });
          if (!staffWorkDays[cId]) staffWorkDays[cId] = new Set();
          staffWorkDays[cId].add(dStr);
          staffCurrentWorkCount[cId] = (staffCurrentWorkCount[cId] || 0) + 1;
          staffHolidayWorkCount[cId] = (staffHolidayWorkCount[cId] || 0) + 1;

          // 2. 振替公休（平日）の付与
          const bestWkday = [...weekdays].filter(wd => {
            const hasJob = staffWorkDays[cId].has(wd) || currentRequests.some(r => r.date === wd && (String(r.staffId) === cId || normalize(r.staffName) === cKey));
            const hasAutoOff = autoAssigned.some(a => (String(a.staffId) === cId || normalize(a.staffName) === cKey) && a.date === wd && a.type === '公休');
            return !hasJob && !hasAutoOff;
          }).sort((a, b) => {
            const aOffs = autoAssigned.filter(x => x.date === a && x.type === '公休').length;
            const bOffs = autoAssigned.filter(x => x.date === b && x.type === '公休').length;
            return aOffs - bOffs;
          })[0];

          if (bestWkday) {
            autoAssigned.push({ staffId: cId, staffName: chosen.name, date: bestWkday, type: '公休', details: { note: '休日振替' } });
          }
        }
      }
    }

    // 3. 平日の割り当て: 出勤数は「平日日数」まで、人数を平均化、5連勤を厳守
    const targetWorkDays = weekdays.length;
    let keepAssigning = true;
    
    // 安全装置: 無限ループ防止のため最大試行回数を設定
    let iterations = 0;
    const maxIterations = weekdays.length * staffList.length * 2;

    while (keepAssigning && iterations < maxIterations) {
      keepAssigning = false;
      iterations++;

      // その時点での「平日」の出勤人数をカウントし、少ない日順にソートする（平均化するため）
      const sortedWeekdays = [...weekdays].sort((a, b) => {
        const aOcc = (dailyOccupants.get(a) || 0) + autoAssigned.filter(x => x.date === a && isWorkingType(x.type)).length;
        const bOcc = (dailyOccupants.get(b) || 0) + autoAssigned.filter(x => x.date === b && isWorkingType(x.type)).length;
        return aOcc - bOcc; // 人数が少ない日を優先
      });

      for (const dStr of sortedWeekdays) {
        // 現在のこの日の出勤人数
        const currentOccupants = (dailyOccupants.get(dStr) || 0) + autoAssigned.filter(x => x.date === dStr && isWorkingType(x.type)).length;
        const config = schedule[dStr];
        
        // （必須ではないが）もし管理画面の制限数を優に超えている場合は、無理に割り当てない
        // ※「基本的な出勤数は平日日数」を優先するため、limitは参考としつつ、必要なら超えてもよい…が、一応limit未満かチェック
        // ただし、今回は「上限人数の平均化・平日日数を満たす」ことが目的なので、limit制限は敢えて外すか緩和する。
        // （ユーザー指示：「平日は人数にかたよりが無いように平均してください。基本的な出勤数は平日日数」）
        
        let candidates = (staffList || [])
          .filter((s: any) => {
            const sId = String(s.id || s.name);
            const sName = normalize(s.name);
            if (s.status === '長期休暇' || s.status === '入職前') return false;

            // 既にこの日に仕事が割り当てられているか？
            const alreadyAssigned = (staffWorkDays[sId]?.has(dStr)) || autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr && isWorkingType(a.type));
            if (alreadyAssigned) return false;

            // この日に休み（公休・年休など）が入っているか？
            const isOff = currentRequests.some((r: any) => (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date === dStr && !isWorkingType(r.type)) ||
                          autoAssigned.some(a => (String(a.staffId) === sId || normalize(a.staffName) === sName) && a.date === dStr && a.type === '公休');
            if (isOff) return false;

            // 目標日数（平日日数）に到達しているか？
            if ((staffCurrentWorkCount[sId] || 0) >= targetWorkDays) return false;

            // 厳守：5連勤以上にならないかチェック
            return !wouldExceedConsecutive(dStr, staffWorkDays[sId] || new Set(), 5);
          })
          .sort((a: any, b: any) => {
            // 出勤日数が最も少ない人を優先してアサイン
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
          break; // 人数カウントが変わるので、日付ソートをやり直すためにループを抜ける
        }
      }
    }


    return res.status(200).json({ newRequests: autoAssigned });
  } catch (e: any) {
    console.error('AI Shift Error:', e);
    return res.status(500).json({ error: e.message });
  }
}


