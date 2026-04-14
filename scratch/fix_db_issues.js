
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

async function fixStreaksAndDuplicates() {
  console.log('Fetching all requests...');
  const { data: requests, error } = await supabase.from('requests').select('*');
  if (error) {
    console.error(error);
    return;
  }

  // 1. Deduplicate by staff_name, date, and type (keep latest)
  console.log('Deduplicating...');
  const seen = new Map();
  const toDelete = [];
  
  requests.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  for (const r of requests) {
    const key = `${r.staff_name}-${r.date}`;
    if (seen.has(key)) {
      toDelete.push(r.id);
    } else {
      seen.set(key, r);
    }
  }

  if (toDelete.length > 0) {
    console.log(`Deleting ${toDelete.length} duplicate records...`);
    // Delete in chunks
    const chunkSize = 50;
    for (let i = 0; i < toDelete.length; i += chunkSize) {
      await supabase.from('requests').delete().in('id', toDelete.slice(i, i + chunkSize));
    }
  }

  // 2. Identify 6-day streaks in June and break them
  console.log('Checking for streaks in June...');
  const { data: staff } = await supabase.from('staff').select('name');
  const freshRequests = (await supabase.from('requests').select('*').gte('date', '2026-06-01').lte('date', '2026-06-30')).data;

  for (const s of staff) {
    if (!s.name) continue;
    const workDates = Array.from(new Set(freshRequests.filter(r => r.staff_name === s.name && isWorkingType(r.type)).map(r => r.date))).sort();
    
    let currentStreak = [];
    for (let i = 0; i < workDates.length; i++) {
      const d = workDates[i];
      if (currentStreak.length === 0) {
        currentStreak = [d];
      } else {
        const prev = new Date(currentStreak[currentStreak.length - 1].replace(/-/g, '/'));
        const curr = new Date(d.replace(/-/g, '/'));
        const diff = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
        if (diff === 1) {
          currentStreak.push(d);
        } else {
          await breakStreakIfNeeds(s.name, currentStreak);
          currentStreak = [d];
        }
      }
    }
    await breakStreakIfNeeds(s.name, currentStreak);
  }
}

async function breakStreakIfNeeds(name, streak) {
  if (streak.length < 6) return;
  console.log(`Breaking streak for ${name} on ${streak[streak.length - 1]}`);
  
  // Pick a date to turn into holiday. Preferably Saturday or Sunday if they are working.
  // Else pick the middle one.
  const targetDate = streak[Math.floor(streak.length / 2)];
  
  // Change existing work record to holiday
  const { data: existing } = await supabase.from('requests').select('*').eq('staff_name', name).eq('date', targetDate);
  if (existing && existing.length > 0) {
    console.log(`Changing ${name}'s ${targetDate} to 公休`);
    await supabase.from('requests').update({ type: '公休', details: { note: 'Streak fix' } }).eq('id', existing[0].id);
  }
}

fixStreaksAndDuplicates();
