const { createClient } = require('@supabase/supabase-js');

const url = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(url, key);

async function testColumn(columnName) {
  try {
    const { data, error } = await supabase.from('shifts').select(columnName).limit(1);
    if (error) {
      console.log(`Column '${columnName}':`, error.message);
    } else {
      console.log(`Column '${columnName}': EXISTS (or no error)`);
    }
  } catch (err) {
    console.error(err);
  }
}

async function main() {
  await testColumn('time_slots');
  await testColumn('start_time');
  await testColumn('staff_id');
  await testColumn('user_id');
  await testColumn('date');
  await testColumn('hours');
}

main();
