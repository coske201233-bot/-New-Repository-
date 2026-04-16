const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifySafeUpsert() {
    console.log('--- ABE Sync Fix Verification ---');
    const testId = 'm-ABE-2026-06-10';
    const now = new Date();
    const futureTime = new Date(now.getTime() + 10000).toISOString(); // 10秒後
    const pastTime = new Date(now.getTime() - 10000).toISOString();   // 10秒前

    console.log(`Target ID: ${testId}`);

    // 1. まず「最新」としてデータをセット
    console.log('Setting current "Latest" data in cloud...');
    await supabase.from('requests').upsert({
        id: testId,
        staff_name: 'ABE',
        date: '2026-06-10',
        type: '公休',
        status: 'approved',
        details: { updatedAt: now.toISOString(), priority: 100 }
    });

    // 2. 「古い」タイムスタンプでの上書きを試行 (Should be rejected by our logic)
    console.log('Attempting to overwrite with OLD timestamp (Stale client scenario)...');
    const staleRequest = {
        id: testId,
        staffName: 'ABE',
        updatedAt: pastTime,
        type: '出勤', // 本来の誤った上書き
        status: 'pending'
    };

    // Logic from cloudStorage.ts (Safe-Upsert)
    const { data: cloudItems } = await supabase
      .from('requests')
      .select('id, details')
      .eq('id', testId);
    
    const cloudItem = cloudItems?.[0];
    const cloudTime = cloudItem?.details?.updatedAt || 0;
    const clientTime = staleRequest.updatedAt;

    console.log(`Cloud Time: ${cloudTime}`);
    console.log(`Client Time: ${clientTime}`);

    if (new Date(clientTime) > new Date(cloudTime)) {
        console.log('FAIL: Stale request was accepted (Incorrect)');
    } else {
        console.log('SUCCESS: Stale request was IGNORED (Correct)');
    }

    // 3. 「新しい」タイムスタンプでの上書きを試行 (Should be accepted)
    console.log('\nAttempting to overwrite with NEW timestamp (Valid update)...');
    const freshRequest = {
        id: testId,
        staffName: 'ABE',
        updatedAt: futureTime,
        type: '公休(修正)', 
        status: 'approved'
    };

    if (new Date(freshRequest.updatedAt) > new Date(cloudTime)) {
        console.log('Proceeding with upsert (Fresh data)...');
        await supabase.from('requests').upsert({
            id: testId,
            staff_name: 'ABE',
            date: '2026-06-10',
            type: '公休(修正)',
            status: 'approved',
            details: { updatedAt: freshRequest.updatedAt, priority: 100 }
        });
        console.log('SUCCESS: Fresh request was accepted');
    } else {
        console.log('FAIL: Fresh request was ignored (Incorrect)');
    }

    // 4. Cleanup (optionally) or final check
    const { data: final } = await supabase.from('requests').select('*').eq('id', testId);
    console.log('\nFinal state in cloud:', final[0].type, final[0].details.updatedAt);
}

verifySafeUpsert();
