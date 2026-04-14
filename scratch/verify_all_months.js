
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

const normalize = (name) => name?.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');
const workingTerms = ['出勤', '日勤', '勤務', '通常', '午前休', '午後休', '午前振替', '午後振替', '時間休', '特休', '看護休暇'];
const isWorking = (type) => workingTerms.some(t => type?.includes(t));

async function checkMonth(monthStr) {
  console.log(`--- Verifying ${monthStr} ---`);
  const { data: requests } = await supabase.from('requests').select('*').eq('status', 'approved').gte('date', `${monthStr}-01`).lte('date', `${monthStr}-31`);
  const staffHistory = {};
  requests.forEach(r => {
    const sname = normalize(r.staff_name);
    if (!staffHistory[sname]) staffHistory[sname] = [];
    staffHistory[sname].push({ date: r.date, working: isWorking(r.type) });
  });

  let violations = 0;
  Object.entries(staffHistory).forEach(([name, history]) => {
    history.sort((a, b) => a.date.localeCompare(b.date));
    let streak = 0;
    let lastDate = null;
    history.forEach(h => {
      if (h.working) {
        const currentDate = new Date(h.date.replace(/-/g, '/'));
        if (lastDate && (currentDate - lastDate) / (1000 * 60 * 60 * 24) === 1) streak++;
        else streak = 1;
        if (streak > 5) {
           console.log(`Violation: ${name} worked ${streak} days straight at ${h.date}`);
           violations++;
        }
        lastDate = currentDate;
      } else {
        streak = 0;
        lastDate = new Date(h.date.replace(/-/g, '/'));
      }
    });
  });
  console.log(`Total violations in ${monthStr}: ${violations}`);
}

async function run() {
  await checkMonth('2026-04');
  await checkMonth('2026-05');
  await checkMonth('2026-06');
}
run();
