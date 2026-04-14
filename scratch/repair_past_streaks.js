
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

const normalize = (name) => name?.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');
const workingTerms = ['出勤', '日勤', '勤務', '通常', '午前休', '午後休', '午前振替', '午後振替', '時間休', '特休', '看護休暇'];
const isWorking = (type) => workingTerms.some(t => type?.includes(t));

async function repairMonth(monthStr) {
  console.log(`\n--- Repairing ${monthStr} ---`);
  const { data: requests } = await supabase.from('requests')
    .select('*')
    .eq('status', 'approved')
    .gte('date', `${monthStr}-01`)
    .lte('date', `${monthStr}-31`);
  
  const staffHistory = {};
  requests.forEach(r => {
    const sname = normalize(r.staff_name);
    if (!staffHistory[sname]) staffHistory[sname] = [];
    staffHistory[sname].push(r);
  });

  for (const [name, history] of Object.entries(staffHistory)) {
    history.sort((a, b) => a.date.localeCompare(b.date));
    let streak = [];
    let lastDate = null;
    
    for (const r of history) {
      const currentDate = new Date(r.date.replace(/-/g, '/'));
      const isConsecutive = lastDate && (currentDate - lastDate) / 86400000 === 1;
      
      if (isWorking(r.type)) {
        if (isConsecutive) streak.push(r);
        else streak = [r];
        
        if (streak.length > 5) {
          console.log(`Found 6-day streak for ${name} ending at ${r.date}. Breaking it...`);
          // 4日目あたりを公休にするのがバランスが良い
          const target = streak[3];
          console.log(`  Replacing ${target.date} (${target.type}, ID=${target.id}) with 公休`);
          
          await supabase.from('requests').update({
             type: '公休',
             details: { ...target.details, note: '連勤調整(自動修正)', isManual: false }
          }).eq('id', target.id);
          
          streak = []; // Reset streak after break
        }
      } else {
        streak = [];
      }
      lastDate = currentDate;
    }
  }
}

async function run() {
  await repairMonth('2026-04');
  await repairMonth('2026-05');
  console.log('Repair complete.');
}
run();
