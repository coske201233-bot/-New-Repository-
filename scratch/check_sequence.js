const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('src/utils/env-config.json'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data } = await supabase.from('staff').select('*').order('created_at', { ascending: true });
  const rawEligible = data.filter(staff => {
    const status = (staff.status || '').trim();
    const placement = (staff.placement || '').trim();
    const profession = (staff.profession || staff.jobType || '').trim();
    const role = (staff.role || '').trim();
    if (status.includes('長期休暇')) return false;
    if (placement.includes('訪問リハ')) return false;
    if (profession.includes('助手')) return false;
    if (placement.includes('助手')) return false;
    if (role.includes('助手')) return false;
    return true;
  });
  console.log(rawEligible.map((s, i) => `${i+1}. ${s.name} (${s.id})`).join('\n'));
}
run();
