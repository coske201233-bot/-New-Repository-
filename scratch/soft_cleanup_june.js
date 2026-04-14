
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

const normalizeName = (name) => String(name || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');

const isWorkingType = (t) => {
  if (!t) return false;
  const workingTerms = ['出勤', '日勤', '通常', '勤務', '早番', '遅番', '夜勤', '午前振替', '午後振替', '特休', '看護休暇'];
  return workingTerms.some(term => t.includes(term));
};

const isManualRecord = (r) => {
  if (!r) return false;
  const idStr = String(r.id || '');
  const type = String(r.type || '').trim();
  const note = String(r.details?.note || '').trim();
  const reason = String(r.reason || '').trim();

  if (idStr.startsWith('m-') || idStr.startsWith('manual-')) return true;
  const leaveTypes = ['年休', '有給', '時間', '振替', '公休', '夏季', '特休', '休暇', '欠勤', '休'];
  if (leaveTypes.some(lt => type.includes(lt))) return true;
  if (r.isManual === true || r.details?.isManual === true) return true;
  if (idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-')) {
    if (note.includes('自動') || reason.includes('自動')) return false;
    if (note === '' && reason === '') return false;
    return true;
  }
  return true;
};

const getPriority = (r) => {
  let score = 0;
  if (isManualRecord(r)) score += 10000; // 手動は絶対優先
  if (r.details?.locked) score += 50000;
  if (r.type === '出勤') score += 100;
  const timeStr = r.details?.updatedAt || r.created_at || 0;
  const time = new Date(timeStr).getTime();
  return score + (time / 1000000000);
};

async function softCleanupJune() {
  console.log('--- STARTING JUNE SOFT CLEANUP V3 ---');
  
  const { data: requests, error } = await supabase.from('requests')
    .select('*')
    .gte('date', '2026-06-01')
    .lte('date', '2026-06-30')
    .neq('status', 'deleted');

  if (error) { console.error(error); return; }
  console.log(`Fetched ${requests.length} active records.`);

  const map = new Map();
  const toSoftDelete = [];

  requests.forEach(r => {
    const key = `${normalizeName(r.staff_name)}-${r.date}`;
    if (!map.has(key)) {
      map.set(key, r);
    } else {
      const existing = map.get(key);
      if (getPriority(r) > getPriority(existing)) {
        toSoftDelete.push(existing);
        map.set(key, r);
      } else {
        toSoftDelete.push(r);
      }
    }
  });

  const dateGroups = {};
  const cleanList = Array.from(map.values());
  cleanList.forEach(r => {
    if (!dateGroups[r.date]) dateGroups[r.date] = [];
    dateGroups[r.date].push(r);
  });

  Object.keys(dateGroups).sort().forEach(dateStr => {
    const day = new Date(dateStr.replace(/-/g, '/'));
    const dayOfWeek = day.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const limit = isWeekend ? 2 : 12;
    
    const workers = dateGroups[dateStr].filter(r => isWorkingType(r.type));
    if (workers.length > limit) {
      workers.sort((a, b) => getPriority(b) - getPriority(a));
      const toRemove = workers.slice(limit);
      toRemove.forEach(r => {
        if (!toSoftDelete.some(s => s.id === r.id)) toSoftDelete.push(r);
      });
    }
  });

  if (toSoftDelete.length > 0) {
    console.log(`Total unique records to SOFT DELETE: ${toSoftDelete.length}`);
    const now = new Date().toISOString();
    
    // 効率化：個別に送らず、まとめて更新したいが、JSONBの中身も更新したいため、
    // やはりループになるが、並列実行する。
    const promises = toSoftDelete.map(r => {
      const newDetails = { ...(r.details || {}), updatedAt: now };
      return supabase.from('requests')
        .update({ status: 'deleted', details: newDetails })
        .eq('id', r.id);
    });

    await Promise.all(promises);
    console.log('All soft-delete updates sent.');
  }

  console.log('Soft cleanup complete.');
}

softCleanupJune();
