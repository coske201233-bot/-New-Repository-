
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

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
  if (isManualRecord(r)) score += 1000;
  if (r.details?.locked) score += 5000;
  if (r.type === '出勤') score += 100;
  // updatedAt or createdAt
  const time = new Date(r.updated_at || r.created_at || 0).getTime();
  return score + (time / 1000000000); // タイムスタンプを微小な加点に
};

async function cleanupJune() {
  console.log('--- STARTING JUNE CLEANUP ---');
  
  // 1. Fetch all staff to check roles/positions
  const { data: staffList } = await supabase.from('staff').select('*');
  const staffRoleMap = {};
  staffList.forEach(s => { staffRoleMap[normalizeName(s.name)] = s.role; });

  // 2. Fetch all June requests
  const { data: requests, error } = await supabase.from('requests')
    .select('*')
    .gte('date', '2026-06-01')
    .lte('date', '2026-06-30');

  if (error) { console.error(error); return; }
  console.log(`Fetched ${requests.length} records for June.`);

  // 3. Deduplicate by Name-Date first (Absolute rule)
  const map = new Map();
  const toDeleteIds = [];

  requests.forEach(r => {
    const key = `${normalizeName(r.staff_name)}-${r.date}`;
    if (!map.has(key)) {
      map.set(key, r);
    } else {
      const existing = map.get(key);
      if (getPriority(r) > getPriority(existing)) {
        toDeleteIds.push(existing.id);
        map.set(key, r);
      } else {
        toDeleteIds.push(r.id);
      }
    }
  });

  console.log(`Deduplication: ${toDeleteIds.length} redundant records marked for deletion.`);

  // 4. Group by Date and enforce limits
  const dateGroups = {};
  const cleanList = Array.from(map.values());
  cleanList.forEach(r => {
    if (!dateGroups[r.date]) dateGroups[r.date] = [];
    dateGroups[r.date].push(r);
  });

  Object.keys(dateGroups).sort().forEach(dateStr => {
    const day = new Date(dateStr);
    const dayOfWeek = day.getDay(); // 0: Sun, 6: Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // TODO: Public holiday check? For now use Saturday/Sunday
    const limit = isWeekend ? 2 : 12;
    
    const workers = dateGroups[dateStr].filter(r => isWorkingType(r.type) && r.status !== 'deleted');
    if (workers.length > limit) {
      console.log(`Date ${dateStr} has ${workers.length} workers, limit is ${limit}. Trimming...`);
      // Sort by priority descending, take the top 'limit'
      workers.sort((a, b) => getPriority(b) - getPriority(a));
      
      const toRemove = workers.slice(limit);
      toRemove.forEach(r => {
        if (!toDeleteIds.includes(r.id)) toDeleteIds.push(r.id);
      });
    }
  });

  // 5. Execute deletions
  if (toDeleteIds.length > 0) {
    const uniqueIds = Array.from(new Set(toDeleteIds));
    console.log(`Total unique records to delete: ${uniqueIds.length}`);
    const chunkSize = 50;
    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
      const chunk = uniqueIds.slice(i, i + chunkSize);
      const { error: delError } = await supabase.from('requests').delete().in('id', chunk);
      if (delError) console.error('Delete error:', delError);
      else console.log(`Deleted chunk ${i/chunkSize + 1}`);
    }
  }

  console.log('Cleanup complete.');
}

cleanupJune();
