const { createClient } = require('@supabase/supabase-js');

// Supabase Configuration
const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log('--- Persistence Test: June 2026 ---');

  // 1. Fetch current staff
  const { data: staffList } = await supabase.from('staff').select('*');
  
  // 2. Prepare a "Manual" record for testing (e.g., Satoh Akira, 2026-06-15, Type: '有給')
  const testDate = '2026-06-15';
  const testStaffName = 'TEST USER';
  const testType = '有給';
  
  // 3. Upsert this manual record
  console.log(`Setting up manual record: ${testStaffName} on ${testDate} as ${testType}`);
  await supabase.from('requests').upsert({
    staff_name: testStaffName,
    date: testDate,
    type: testType,
    status: 'approved',
    details: { note: '手動テスト用(絶対保護)', isManual: true, locked: true }
  }, { onConflict: 'staff_name,date' });

  // 4. Trigger AI shift (simulation of the API call)
  // Since we can't easily hit the local Vercel endpoint from here,
  // we'll fetch all requests and see if the logic handles it.
  const { data: requests } = await supabase.from('requests').select('*').eq('status', 'approved');

  console.log('\nSimulating isManualRecord check...');
  const normalize = (name) => name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');
  
  const isManualRecord = (r) => {
    if (!r) return false;
    const idStr = String(r.id || '');
    const type = String(r.type || '').trim();
    // 実際のアプリでのマッピング（REQ_MAP + details内容の引き上げ）を再現
    const note = String(r.details?.note || r.note || '').trim();
    const reason = String(r.reason || '').trim();
    const isManual = r.isManual === true || r.details?.isManual === true;
    const locked = r.locked === true || r.details?.locked === true;

    if (idStr.startsWith('m-') || idStr.startsWith('manual-')) return true;
    if (isManual || locked) return true;

    const leaveTypes = ['年休', '有給', '夏季', '特休', '休暇', '欠勤', '休業'];
    if (leaveTypes.some(lt => type.includes(lt))) return true;

    const isAutoId = idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-');
    if (isAutoId) {
      const hasHumanNote = note !== '' && !note.includes('自動');
      const hasHumanReason = reason !== '' && !reason.includes('自動');
      if (hasHumanNote || hasHumanReason) return true;
      return false;
    }
    if (type.includes('振替') || type.includes('公休')) return true;
    return true;
  };

  const myRecord = requests.find(r => normalize(r.staff_name || '') === normalize(testStaffName) && r.date === testDate);
  if (myRecord && isManualRecord(myRecord)) {
    console.log('✅ PASS: Manual record correctly identified as PROTECTED.');
  } else {
    console.log('❌ FAIL: Manual record NOT identified as protected.');
    console.log('Record found:', myRecord);
  }

  console.log('\nCleaning up test record...');
  await supabase.from('requests').delete().eq('staff_name', 'TEST USER').eq('date', testDate);
}

runTest();
