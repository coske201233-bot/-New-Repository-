
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

async function checkStreak(name) {
  console.log(`Checking streak for ${name} in June 2026...`);
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .eq('staff_name', name)
    .gte('date', '2026-06-01')
    .lte('date', '2026-06-30')
    .order('date', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const workDates = Array.from(new Set(data.filter(r => isWorkingType(r.type)).map(r => r.date))).sort();
  console.log(`${name} Unique Work Dates:`, workDates);

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
        if (currentStreak.length >= 6) {
          console.log(`!!! STREAK FOUND for ${name} !!!:`, currentStreak);
        }
        currentStreak = [d];
      }
    }
  }
  if (currentStreak.length >= 6) {
    console.log(`!!! STREAK FOUND for ${name} !!!:`, currentStreak);
  }
}

async function run() {
  const { data: staff, error } = await supabase.from('staff').select('name');
  if (error) {
    console.error(error);
    return;
  }
  for (const s of staff) {
    if (s.name) await checkStreak(s.name);
  }
}

run();
