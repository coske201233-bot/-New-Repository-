
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .limit(1);
    
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Sample staff record columns:', Object.keys(data[0] || {}));
  }
  
  const { data: config, error: configError } = await supabase
    .from('config')
    .select('*');
    
  if (configError) {
    console.error('Config Error:', configError);
  } else {
    console.log('Config entries:', config);
  }
}

checkSchema();
