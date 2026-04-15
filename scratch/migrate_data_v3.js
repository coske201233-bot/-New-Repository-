const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';

const supabase = createClient(supabaseUrl, supabaseKey);

const mapping = {
  'NAKANO': ['中野'],
  'SAKASITA': ['坂下'],
  'ABE': ['阿部'],
  'YAMAKAWA': ['山川'],
  'YOSHIDA': ['吉田'],
  'SAKUMA': ['佐久間'],
  'TUJI': ['辻'],
  'MORITA': ['森田'],
  'OONUMA': ['大沼'],
  'KUBOTA': ['久保田'],
  'FUJIMORI': ['藤森', '藤森 渓', '藤森渓'],
  'NANJO': ['南條', '南条'],
  'MITUI': ['三井', '三井諒'],
  'OGASAWARA': ['小笠原'],
  'SUZUKI': ['鈴木'],
  'SATOKOKI': ['佐藤公貴', '佐藤 公貴', '佐藤公']
};

async function runMerge() {
  console.log('Starting merge for non-deleted staff (staff_name column only)...');

  for (const [newName, oldNames] of Object.entries(mapping)) {
    for (const oldName of oldNames) {
      const { data, error, count } = await supabase
        .from('requests')
        .update({ staff_name: newName })
        .eq('staff_name', oldName)
        .select();
      
      if (error) {
        console.error(`Error merging ${oldName} to ${newName}:`, error);
      } else {
        console.log(`Merged "${oldName}" -> "${newName}" (${data?.length || 0} records updated)`);
      }
    }
  }

  console.log('Merge complete.');
}

runMerge();
