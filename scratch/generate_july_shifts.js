const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- Logic from updated api/ai-shift.ts ---
const PREFERRED_ORDER = [
  '吉田', '佐藤公貴', '佐藤晃', '三井諒', '阿部', '藤森渓', '坂下', '佐久間', '中野', '山川', '久保田', '小笠原', '森田', '駒津', '馬淵由貴子'
];

const normalize = (name) => {
  if (!name || typeof name !== 'string') return '';
  let n = name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');
  if (n === '佐藤公') return '佐藤公貴';
  if (n === '藤森') return '藤森渓';
  if (n === '三井') return '三井諒';
  if (n === '佐藤') return '佐藤晃';
  if (n === '馬淵') return '馬淵由貴子';
  if (n === '吉田誠') return '吉田';
  return n;
};

const isWorkingType = (t) => {
  const workingTerms = ['出勤', '日勤', '勤務', '通常', '公休', '午前休', '午後休', '午前振替', '午後振替', '時間休', '特休', '看護休暇'];
  return workingTerms.some(term => (t || '').includes(term));
};

const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const JAPAN_HOLIDAYS_SET = new Set([
  '2026-07-20' // 7月の祝日（海の日）
]);

async function generateJulyShifts() {
  const year = 2026;
  const month = 7;
  const monthPrefix = '2026-07';

  console.log(`Starting generation for ${monthPrefix}...`);

  // 0. AGGRESSIVE PURGE
  console.log('Performing aggressive purge for July...');
  const { data: allJuly } = await supabase.from('requests').select('id').like('date', '2026-07%');
  const autoIds = (allJuly || []).map(x => x.id).filter(id => 
    id.startsWith('auto-') || id.startsWith('af-') || id.startsWith('aw-') || id.startsWith('plan-') || id.startsWith('aw_')
  );
  if (autoIds.length > 0) {
    console.log(`Deleting ${autoIds.length} existing auto-shifts...`);
    await supabase.from('requests').delete().in('id', autoIds);
  }

  // 1. Fetch Data
  const { data: staffList } = await supabase.from('staff').select('*');
  const { data: allRequests } = await supabase.from('requests').select('*');
  const { data: configs } = await supabase.from('app_config').select('*');
  const limits = configs.find(c => c.key === '@monthly_limits')?.value?.['2026-07'] || { weekday: 12, sat: 2, sun: 0, pub: 2 };

  console.log(`Staff: ${staffList.length}, Total Requests: ${allRequests.length}`);

  // 2. Prepare Matching
  const idToStaff = new Map();
  const nameToStaff = new Map();
  staffList.forEach(s => {
    const realId = String(s.id);
    idToStaff.set(realId, s);
    const normalizedName = normalize(s.name);
    if (normalizedName) nameToStaff.set(normalizedName, s);
  });

  const findStaff = (id, name) => {
    const sId = id ? String(id) : '';
    if (sId && idToStaff.has(sId)) return idToStaff.get(sId);
    const sName = normalize(name);
    if (sName && nameToStaff.has(sName)) return nameToStaff.get(sName);
    return null;
  };

  // 3. Define Schedule
  const lastDay = new Date(year, month, 0).getDate();
  const schedule = {};
  const holidays = [];
  const weekdays = [];

  for (let i = 1; i <= lastDay; i++) {
    const d = new Date(year, month - 1, i);
    const dateStr = toDateStr(d);
    const dow = d.getDay();
    const isPub = JAPAN_HOLIDAYS_SET.has(dateStr);
    let type = 'weekday', lim = limits.weekday;

    if (dow === 0) {
      type = 'sun';
      lim = isPub ? Math.min(limits.sun, limits.pub) : limits.sun;
    } else if (dow === 6) {
      type = 'sat';
      lim = isPub ? Math.min(limits.sat, limits.pub) : limits.sat;
    } else if (isPub) {
      type = 'pub';
      lim = limits.pub;
    }

    schedule[dateStr] = { type, limit: Number(lim) };
    if (type === 'weekday') weekdays.push(dateStr);
    else holidays.push(dateStr);
  }

  // 4. Initial Counts
  const staffWorkDays = {};
  const staffCurrentWorkCount = {};
  const dailyOccupants = new Map();
  const allCurrentRequests = allRequests.filter(r => r.date.startsWith(monthPrefix) && r.status === 'approved');

  staffList.forEach(s => {
    const sId = String(s.id);
    const works = allCurrentRequests.filter(r => {
      const staff = findStaff(r.staff_id || r.staffId, r.staff_name || r.staffName);
      return staff && String(staff.id) === sId && isWorkingType(r.type);
    }).map(r => r.date);

    staffWorkDays[sId] = new Set(works);
    staffCurrentWorkCount[sId] = works.length;
    works.forEach(dStr => dailyOccupants.set(dStr, (dailyOccupants.get(dStr) || 0) + 1));
  });

  holidays.forEach(dStr => { if (!dailyOccupants.has(dStr)) dailyOccupants.set(dStr, 0); });
  weekdays.forEach(dStr => { if (!dailyOccupants.has(dStr)) dailyOccupants.set(dStr, 0); });

  // 5. Holiday Queue with July Rotation
  const holidayQueue = staffList.filter(s => {
      const isAssistant = s.profession === '助手' || s.placement === '助手';
      const isUnavailable = s.status === '長期休暇' || s.status === '入職前';
      const isMonthlyNoHoliday = s.monthly_no_holiday?.['2026-07'] || s.no_holiday;
      return !isAssistant && !isUnavailable && !isMonthlyNoHoliday;
  }).sort((a, b) => {
      const pA = PREFERRED_ORDER.indexOf(normalize(a.name));
      const pB = PREFERRED_ORDER.indexOf(normalize(b.name));
      const rotationIndex = 12; // 13番目: 森田
      const rotate = (idx) => {
          if (idx === -1) return 999;
          return (idx - rotationIndex + PREFERRED_ORDER.length) % PREFERRED_ORDER.length;
      };
      return rotate(pA) - rotate(pB);
  });

  console.log(`Holiday Queue: ${holidayQueue.map(s => s.name).join(', ')}`);

  // 6. Holiday Assignment Loop (STRICT ORDER)
  const autoAssigned = [];
  
  for (const dStr of holidays) {
      const config = schedule[dStr];
      const occupants = dailyOccupants.get(dStr) || 0;
      const remaining = config.limit - occupants;
      
      console.log(`Date: ${dStr}, Limit: ${config.limit}, Current: ${occupants}, Adding: ${Math.max(0, remaining)}`);

      for (let i = 0; i < remaining; i++) {
          let chosenIdx = -1;
          for (let q = 0; q < holidayQueue.length; q++) {
              const s = holidayQueue[q];
              const sId = String(s.id);
              if (staffWorkDays[sId].has(dStr) || autoAssigned.some(a => a.staffId === sId && a.date === dStr)) continue;
              
              // Skip only if manual OFF exists
              if (allCurrentRequests.some(r => findStaff(r.staff_id || r.staffId, r.staff_name || r.staffName)?.id === s.id && r.date === dStr && !isWorkingType(r.type))) continue;
              
              // [STRICT] Disable penalty checks for July 2026
              chosenIdx = q;
              break;
          }
          
          if (chosenIdx !== -1) {
              const chosen = holidayQueue[chosenIdx];
              holidayQueue.splice(chosenIdx, 1);
              holidayQueue.push(chosen);
              
              const cId = String(chosen.id);
              autoAssigned.push({
                  id: `auto-${cId}-${dStr}`, // Standard ID
                  staff_name: chosen.name,
                  date: dStr,
                  type: '出勤',
                  status: 'approved',
                  details: { note: '自動割当(休日)', staffId: cId }
              });
              staffWorkDays[cId].add(dStr);
              staffCurrentWorkCount[cId] = (staffCurrentWorkCount[cId] || 0) + 1;
              dailyOccupants.set(dStr, dailyOccupants.get(dStr) + 1);

              // 2. Compensatory Day Off
              const sortedWeekdays = [...weekdays].sort((a, b) => {
                  const aOffs = autoAssigned.filter(x => x.date === a && x.type === '公休');
                  const bOffs = autoAssigned.filter(x => x.date === b && x.type === '公休');
                  return aOffs.length - bOffs.length;
              });

              const bestWkday = sortedWeekdays.find(wd => {
                  const hasJob = staffWorkDays[cId].has(wd) || allCurrentRequests.some(r => findStaff(r.staff_id, r.staff_name)?.id === cId && r.date === wd);
                  const hasAutoOff = autoAssigned.some(a => a.staffId === cId && a.date === wd && a.type === '公休');
                  return !hasJob && !hasAutoOff;
              });

              if (bestWkday) {
                  autoAssigned.push({
                      id: `auto-off-${cId}-${bestWkday}`, // Standard ID
                      staff_name: chosen.name,
                      date: bestWkday,
                      type: '公休',
                      status: 'approved',
                      details: { note: '休日振替', staffId: cId }
                  });
              }
          }
      }
  }

  // 7. Weekday Assignment (Flexible)
  const targetWorkDays = weekdays.length;
  for (const dStr of weekdays) {
      const config = schedule[dStr];
      const targetForThisDay = config.limit;
      
      const candidates = staffList.filter(s => {
          const sId = String(s.id);
          if (s.status === '長期休暇' || s.status === '入職前') return false;
          if (staffWorkDays[sId].has(dStr) || autoAssigned.some(a => a.staffId === sId && a.date === dStr)) return false;
          const isOff = allCurrentRequests.some(r => findStaff(r.staff_id, r.staff_name)?.id === s.id && r.date === dStr && !isWorkingType(r.type)) ||
                        autoAssigned.some(a => a.staffId === sId && a.date === dStr && a.type === '公休');
          if (isOff) return false;
          return true;
      }).sort((a, b) => {
          const aId = String(a.id);
          const bId = String(b.id);
          return (staffCurrentWorkCount[aId] || 0) - (staffCurrentWorkCount[bId] || 0);
      });

      for (const chosen of candidates) {
          const cId = String(chosen.id);
          const cCount = staffCurrentWorkCount[cId] || 0;
          
          const currentOcc = (dailyOccupants.get(dStr) || 0) + autoAssigned.filter(x => x.date === dStr && x.type === '出勤').length;
          
          if (currentOcc < targetForThisDay || cCount < targetWorkDays) {
              autoAssigned.push({
                  id: `auto-wd-${cId}-${dStr}`, // Standard ID
                  staff_name: chosen.name,
                  date: dStr,
                  type: '出勤',
                  status: 'approved',
                  details: { note: '自動割当(平日)', staffId: cId }
              });
              staffWorkDays[cId].add(dStr);
              staffCurrentWorkCount[cId] = (staffCurrentWorkCount[cId] || 0) + 1;
          }
      }
  }

  // 8. Save to DB
  console.log(`Generated ${autoAssigned.length} total auto-shifts.`);
  
  if (autoAssigned.length > 0) {
      const { error: insError } = await supabase.from('requests').upsert(autoAssigned);
      if (insError) console.error('Insert error:', insError);
      else console.log('Successfully saved to cloud.');
  }
}

generateJulyShifts();
