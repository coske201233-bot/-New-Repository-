
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function fixOverlap() {
  console.log('Fetching future overlaps for Kubota and Sakuma...');
  
  const { data: requests, error } = await supabase
    .from('requests')
    .select('*')
    .or('staff_name.eq.久保田,staff_name.eq.佐久間')
    .gte('date', '2026-04-13')
    .eq('type', '公休');

  if (error) {
    console.error('Error fetching requests:', error);
    return;
  }

  const kubotaOffs = requests.filter(r => r.staff_name === '久保田');
  const sakumaOffs = requests.filter(r => r.staff_name === '佐久間');

  const overlaps = kubotaOffs.filter(ko => sakumaOffs.some(so => so.date === ko.date));
  console.log('Found overlaps:', overlaps.map(o => o.date));

  let alternate = true;
  for (const o of overlaps) {
    const date = o.date;
    const kubotaReq = kubotaOffs.find(r => r.date === date);
    const sakumaReq = sakumaOffs.find(r => r.date === date);

    // Alternate who stays off
    const stayOff = alternate ? '久保田' : '佐久間';
    const switchToWork = alternate ? '佐久間' : '久保田';
    const targetReq = alternate ? sakumaReq : kubotaReq;

    console.log(`Date ${date}: ${stayOff} stays Off, switching ${switchToWork} to Work.`);

    // Update the request to type '出勤'
    const { error: updateError } = await supabase
      .from('requests')
      .update({ type: '出勤', details: { note: 'Overlap fix: Switched to Work' } })
      .eq('id', targetReq.id);

    if (updateError) {
      console.error(`Failed to update ${switchToWork} on ${date}:`, updateError);
    } else {
      console.log(`Successfully updated ${switchToWork} on ${date}.`);
    }

    alternate = !alternate;
  }
}

fixOverlap();
