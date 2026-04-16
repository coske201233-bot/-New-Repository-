const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = 'https://nizhtuzqmtlgfqmxpybb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function restoreData() {
    console.log('--- EMERGENCY RESTORE STARTED ---');
    try {
        const rawData = fs.readFileSync('requests_backup_full.json', 'utf8');
        const data = JSON.parse(rawData);
        console.log(`Loaded ${data.length} records from backup.`);

        // チャンクに分けてアップロード
        const chunkSize = 100;
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            console.log(`Uploading chunk ${i / chunkSize + 1}...`);
            const { error } = await supabase.from('requests').upsert(chunk, { onConflict: 'id' });
            if (error) {
                console.error('Error in chunk:', error);
            }
        }
        console.log('--- RESTORE COMPLETE ---');
    } catch (e) {
        console.error('Restore failed:', e);
    }
}

restoreData();
