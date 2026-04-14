
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const isWorkingType = (type) => {
  if (!type) return false;
  const t = String(type);
  const workingTerms = ['出勤', '日勤', '勤務', '通常', '午前休', '午後休', '午前振替', '午後振替', '時間給', '時間休', '特休', '看護休暇'];
  return workingTerms.some(term => t.includes(term));
};

async function nuclearFix() {
  console.log('--- NUCLEAR DB FIX START ---');
  
  // 1. Fetch EVERYTHING for June
  const { data: allRequests, error } = await supabase.from('requests').select('*').gte('date', '2026-06-01').lte('date', '2026-06-30');
  if (error) { console.error(error); return; }

  // 2. Identify ONLY the one true record per person per day
  // Priority: Approved > Not Auto > Latest
  console.log(`Processing ${allRequests.length} records...`);
  const finalSet = new Map();
  
  // Sort by created_at ascending so later ones overwrite
  allRequests.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  
  for (const r of allRequests) {
    const key = `${r.staff_name}-${r.date}`;
    // Manual/Locked records overwrite auto ones
    const isAuto = r.id.startsWith('auto-') || r.id.startsWith('af-') || r.id.startsWith('aw-');
    if (!finalSet.has(key) || !isAuto) {
      finalSet.set(key, r);
    }
  }

  const idsToKeep = new Set(Array.from(finalSet.values()).map(r => r.id));
  const idsToDelete = allRequests.map(r => r.id).filter(id => !idsToKeep.has(id));

  if (idsToDelete.length > 0) {
    console.log(`Deleting ${idsToDelete.length} redundant/duplicate records...`);
    for (let i = 0; i < idsToDelete.length; i += 50) {
      await supabase.from('requests').delete().in('id', idsToDelete.slice(i, i + 50));
    }
  }

  // 3. Now check streaks on the CLEAN data
  const { data: cleanRequests } = await supabase.from('requests').select('*').gte('date', '2026-06-01').lte('date', '2026-06-30');
  const { data: staff } = await supabase.from('staff').select('name');

  for (const s of staff) {
    if (!s.name) continue;
    const workDates = Array.from(new Set(cleanRequests.filter(r => r.staff_name === s.name && isWorkingType(r.type)).map(r => r.date))).sort();
    
    let streak = [];
    for (const d of workDates) {
      if (streak.length === 0) streak = [d];
      else {
        const prev = new Date(streak[streak.length - 1].replace(/-/g, '/'));
        const curr = new Date(d.replace(/-/g, '/'));
        if (Math.round((curr - prev) / 86400000) === 1) streak.push(d);
        else {
          await fixStreak(s.name, streak);
          streak = [d];
        }
      }
    }
    await fixStreak(s.name, streak);
  }
}

async function fixStreak(name, streak) {
  if (streak.length < 6) return;
  console.log(`FIXING STREAK: ${name} (${streak.length} days) ending ${streak[streak.length - 1]}`);
  
  // Choose a day in the middle to break. Ideally a Saturday if it's there.
  let breakIdx = Math.floor(streak.length / 2);
  for (let i = 0; i < streak.length; i++) {
    const d = new Date(streak[i].replace(/-/g, '/'));
    if (d.getDay() === 6 || d.getDay() === 0) { // Sat or Sun
      breakIdx = i;
      break;
    }
  }

  const targetDate = streak[breakIdx];
  const { data: existing } = await supabase.from('requests').select('*').eq('staff_name', name).eq('date', targetDate);
  if (existing && existing.length > 0) {
    console.log(`Setting ${name} on ${targetDate} to 公休`);
    const { error } = await supabase.from('requests').update({ type: '公休', details: { note: 'Streak Fix Nuclear' } }).eq('id', existing[0].id);
    if (error) console.error(error);
  }
}

nuclearFix();
