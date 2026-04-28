
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function generate() {
    console.log('--- [FINAL JULY 2026 GENERATION] ---');
    
    // 1. Fetch Staff (Sorted by name or something stable)
    const { data: staffList } = await supabase.from('staff').select('*');
    // 名前でソートして安定した順番を確保（中野さんが1番、森田さんが13番になるはず）
    const sortedStaff = staffList.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    
    // [CRITICAL] 森田さんを13番目（開始地点）として特定
    const moritaIdx = sortedStaff.findIndex(s => (s.name || '').includes('森田'));
    if (moritaIdx === -1) {
        console.error('Morita not found in staff list!');
        return;
    }
    console.log(`Starting from: ${sortedStaff[moritaIdx].name} (Index: ${moritaIdx})`);

    const year = 2026;
    const month = 7;
    const lastDay = 31;
    
    // 既存データの削除
    console.log('Purging existing July data...');
    await supabase.from('requests').delete().like('date', '2026-07%');
    await supabase.from('shifts').delete().like('date', '2026-07%');

    const results = [];
    let currentStaffIdx = moritaIdx; // Start from Morita

    // 休日等の制限 (土日祝は2人、平日は12人)
    const HOLIDAY_LIMIT = 2;
    const WEEKDAY_LIMIT = 12;

    for (let day = 1; day <= lastDay; day++) {
        const dateStr = `${year}-07-${String(day).padStart(2, '0')}`;
        const date = new Date(year, 6, day);
        const dayOfWeek = date.getDay();
        const isHoliday = (dayOfWeek === 0 || dayOfWeek === 6 || day === 20); // 7/20は海の日(祝)
        
        const limit = isHoliday ? HOLIDAY_LIMIT : WEEKDAY_LIMIT;
        
        for (let i = 0; i < limit; i++) {
            const staff = sortedStaff[currentStaffIdx % sortedStaff.length];
            
            results.push({
                id: `final-july-${staff.id}-${dateStr}`,
                user_id: null,
                staff_name: staff.name,
                date: dateStr,
                type: '出勤',
                status: 'approved',
                details: {
                    note: '最終確定割当 (修正版)',
                    isHolidayShift: isHoliday,
                    staffId: staff.id
                }
            });

            // 休日出勤の場合は振替休日を付与
            if (isHoliday) {
                // 同じ週の平日を公休にする（簡易ロジック：直後の平日）
                let compDay = day + 1;
                while (compDay <= lastDay) {
                    const cDate = new Date(year, 6, compDay);
                    const cDayOfWeek = cDate.getDay();
                    const cIsHoliday = (cDayOfWeek === 0 || cDayOfWeek === 6 || compDay === 20);
                    if (!cIsHoliday) {
                        results.push({
                            id: `final-july-off-${staff.id}-${year}-07-${String(compDay).padStart(2, '0')}`,
                            user_id: null,
                            staff_name: staff.name,
                            date: `${year}-07-${String(compDay).padStart(2, '0')}`,
                            type: '公休',
                            status: 'approved',
                            details: { 
                                note: `${dateStr}の振替休日`,
                                staffId: staff.id
                            }
                        });
                        break;
                    }
                    compDay++;
                }
            }

            currentStaffIdx++;
        }
    }

    console.log(`Generated ${results.length} records. Writing to DB...`);
    
    // Split into chunks of 100
    for (let i = 0; i < results.length; i += 100) {
        const chunk = results.slice(i, i + 100);
        const { error } = await supabase.from('requests').insert(chunk);
        if (error) console.error('Insert error:', error);
    }

    console.log('--- [DONE] ---');
}

generate();
