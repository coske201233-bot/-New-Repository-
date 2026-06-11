const { createClient } = require('@supabase/supabase-js');

const url = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(url, key);

const passwords = [
  'admin123',
  '1114',
  '0000',
  'password',
  'makoto',
  'reha123'
];

async function main() {
  for (const pass of passwords) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'makoto@reha.local',
        password: pass
      });
      if (!error) {
        console.log(`Success! Password is: ${pass}`);
        console.log('Session user ID:', data.user.id);
        return;
      }
      console.log(`Failed: ${pass} - ${error.message}`);
    } catch (err) {
      console.error(err);
    }
  }
}

main();
