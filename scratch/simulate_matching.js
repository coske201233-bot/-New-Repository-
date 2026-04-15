const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

// Logics from the app
const normalizeName = (name) => {
  if (!name || typeof name !== 'string') return '';
  let n = name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '');
  n = n.replace(/條/g, '条').replace(/齊/g, '斉').replace(/齋/g, '斎');
  return n.toUpperCase();
};

async function simulateLogic() {
  const staffRes = await supabase.from('staff').select('*');
  const reqRes = await supabase.from('requests').select('*').neq('status', 'deleted');
  
  const staffList = staffRes.data;
  const requests = reqRes.data;

  const targets = [
    { name: 'SATOKOKI', date: '2026-04-11' },
    { name: 'SAKASITA', date: '2026-05-04' },
    { name: 'NAKANO', date: '2026-05-05' }
  ];

  console.log('--- Simulating Calendar Matching Logic ---');

  targets.forEach(t => {
    console.log(`\nChecking for ${t.name} on ${t.date}:`);
    
    // Find staff
    const staff = staffList.find(s => normalizeName(s.name) === normalizeName(t.name));
    if (!staff) {
      console.log(`❌ Staff NOT found for name "${t.name}"`);
      return;
    }
    console.log(`✅ Staff found: ID=${staff.id}, Name="${staff.name}"`);

    // Find requests
    const dailyReqs = requests.filter(r => r.date === t.date);
    console.log(`   Found ${dailyReqs.length} total requests in DB for this date.`);
    
    const userReqs = dailyReqs.filter(r => normalizeName(r.staff_name) === normalizeName(staff.name));
    
    if (userReqs.length > 0) {
      userReqs.forEach(r => {
        console.log(`   ✅ Request Matched: ID=${r.id}, StaffName="${r.staff_name}", Type="${r.type}", Status="${r.status}"`);
      });
    } else {
      console.log(`   ❌ No request matched for staff "${staff.name}"`);
      console.log(`   DEBUG: Normalize("${staff.name}") = "${normalizeName(staff.name)}"`);
      console.log(`   DEBUG: Names on this date in DB: ${dailyReqs.map(r => `"${r.staff_name}" -> "${normalizeName(r.staff_name)}"`).join(', ')}`);
    }
  });
}

simulateLogic();
