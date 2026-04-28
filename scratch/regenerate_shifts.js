const { generateMonthlyShifts } = require('../src/utils/shiftEngine');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const year = 2026;
  const month = 9;
  const limits = {
    weekdayCap: 15,
    satCap: 2,
    sunCap: 2,
    holidayCap: 2
  };
  
  console.log(`Starting regeneration for ${year}/${month}...`);
  try {
    const results = await generateMonthlyShifts(year, month, limits);
    console.log(`Successfully generated ${results.length} shifts.`);
  } catch (e) {
    console.error('Error during regeneration:', e);
  }
}

run();
