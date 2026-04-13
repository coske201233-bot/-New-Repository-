const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

const normalizeName = (name) => String(name || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');

const isLocked = (i) => i.details?.locked === true;

const isManual = (i) => {
  if (!i) return false;
  const idStr = String(i.id || '');
  const type = String(i.type || '');
  const note = String(i.details?.note || '');
  if (idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('off-')) return true;
  if (i.details?.isManual === true) return true;
  if (['年休', '時間', '有給', '振替', '公休', '休暇'].some(t => type.includes(t))) return true;
  if (!idStr.startsWith('auto-') && !idStr.startsWith('af-') && !idStr.startsWith('aw-')) return true;
  return false;
};

const getTime = (i) => {
  const t = i.updated_at || i.created_at || 0;
  return new Date(t).getTime();
};

async function enforceLockDown() {
  console.log('Enforcing lockdown cleanup...');
  const { data: requests, error } = await supabase.from('requests').select('*').limit(100000);
  if (error) { console.error(error); return; }

  const map = new Map();
  const discardedIds = [];

  requests.forEach(item => {
    const key = `${normalizeName(item.staff_name)}-${item.date}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      return;
    }

    const isLNew = isLocked(item);
    const wasLOld = isLocked(existing);
    const isMNew = isManual(item);
    const wasMOld = isManual(existing);

    let isPriority = false;
    if (isLNew && !wasLOld) {
      isPriority = true;
    } else if (!isLNew && wasLOld) {
      isPriority = false;
    } else if (isMNew && !wasMOld) {
      isPriority = true;
    } else if (!isMNew && wasMOld) {
      isPriority = false;
    } else {
      const timeNew = getTime(item);
      const timeOld = getTime(existing);
      if (timeNew > timeOld) isPriority = true;
      else isPriority = false;
    }

    if (isPriority) {
      discardedIds.push(existing.id);
      map.set(key, item);
    } else {
      discardedIds.push(item.id);
    }
  });

  console.log(`Lockdown: ${discardedIds.length} obsolete records found.`);
  if (discardedIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < discardedIds.length; i += chunkSize) {
      const chunk = discardedIds.slice(i, i + chunkSize);
      await supabase.from('requests').delete().in('id', chunk);
      console.log(`Deleted chunk ${i/chunkSize + 1}`);
    }
  }
  console.log('Lockdown complete.');
}

enforceLockDown();
