
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

const normalize = (name) => {
  if (!name) return '';
  return name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');
};

const workingTerms = ['出勤', '日勤', '勤務', '通常', '午前休', '午後休', '午前振替', '午後振替', '時間休', '特休', '看護休暇'];
const isWorking = (type) => workingTerms.some(t => type?.includes(t));

async function verifyJune() {
  console.log('--- Verifying June 2026 Schedule ---');
  const { data: requests, error } = await supabase
    .from('requests')
    .select('*')
    .eq('status', 'approved')
    .gte('date', '2026-06-01')
    .lte('date', '2026-06-30');

  if (error) {
     console.error(error);
     return;
  }

  const holidayWork = {};
  const staffWorkMap = {};

  requests.forEach(r => {
    const d = new Date(r.date.replace(/-/g, '/'));
    const isHol = d.getDay() === 0 || d.getDay() === 6;
    const working = isWorking(r.type);
    const sname = normalize(r.staff_name);

    if (isHol && working) {
      holidayWork[r.date] = holidayWork[r.date] || [];
      holidayWork[r.date].push(sname);
    }

    if (!staffWorkMap[sname]) staffWorkMap[sname] = [];
    staffWorkMap[sname].push({ date: r.date, working });
  });

  console.log('\n[Rule 1: Holiday Limit (Max 2)]');
  Object.entries(holidayWork).sort().forEach(([date, workers]) => {
    if (workers.length > 2) {
      console.log(`❌ ERROR: ${date} has ${workers.length} workers: ${workers.join(', ')}`);
    } else {
      console.log(`✅ ${date}: ${workers.length} workers`);
    }
  });

  console.log('\n[Rule 2: Max 5 Consecutive Working Days]');
  Object.entries(staffWorkMap).forEach(([name, history]) => {
    history.sort((a, b) => a.date.localeCompare(b.date));
    let streak = 0;
    let maxStreak = 0;
    let streakEnd = '';
    let lastDate = null;

    history.forEach(h => {
      const currentDate = new Date(h.date.replace(/-/g, '/'));
      let wasConsecutive = false;
      if (lastDate) {
        const diff = (currentDate - lastDate) / (1000 * 60 * 60 * 24);
        if (diff === 1) wasConsecutive = true;
      }

      if (h.working) {
        if (wasConsecutive) {
          streak++;
        } else {
          streak = 1;
        }
        if (streak > maxStreak) {
          maxStreak = streak;
          streakEnd = h.date;
        }
      } else {
        streak = 0;
      }
      lastDate = currentDate;
    });

    if (maxStreak > 5) {
      console.log(`❌ ERROR: ${name} worked ${maxStreak} days straight ending ${streakEnd}`);
    } else {
      console.log(`✅ ${name}: max streak ${maxStreak}`);
    }
  });

  const { data: staffList } = await supabase.from('staff').select('*');
  console.log('\n[Rule 3: No Holidays for Restricted Staff]');
  staffList.forEach(s => {
    const name = normalize(s.name);
    const noHoliday = s.no_holiday === true;
    if (noHoliday && holidayWork) {
      Object.entries(holidayWork).forEach(([date, workers]) => {
        if (workers.includes(name)) {
          console.log(`❌ ERROR: ${name} is working on ${date} but is marked as no_holiday`);
        }
      });
    }
  });

  console.log('\n[Rule 4: Overall Fairness (Holiday Shift Counts)]');
  const counts = Object.entries(staffWorkMap).map(([name, history]) => {
    const hCount = history.filter(h => {
       const d = new Date(h.date.replace(/-/g, '/'));
       return (d.getDay() === 0 || d.getDay() === 6) && h.working;
    }).length;
    return { name, hCount };
  }).sort((a, b) => b.hCount - a.hCount);
  
  counts.forEach(c => {
    console.log(`${c.name}: ${c.hCount} holiday shifts`);
  });
}

verifyJune();
