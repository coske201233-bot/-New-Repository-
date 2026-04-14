
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('requests_dump.json', 'utf8'));


const isWeekend = (dateStr) => {
  const d = new Date(dateStr.replace(/-/g, '/'));
  return d.getDay() === 0 || d.getDay() === 6;
};

const kubotaOffs = data.filter(r => r.staff_name.includes('久保田') && r.type === '公休' && !isWeekend(r.date));
const sakumaOffs = data.filter(r => r.staff_name.includes('佐久間') && r.type === '公休' && !isWeekend(r.date));

console.log('Kubota Weekday Offs:', kubotaOffs.map(o => o.date));
console.log('Sakuma Weekday Offs:', sakumaOffs.map(o => o.date));

const overlaps = kubotaOffs.filter(ko => sakumaOffs.some(so => so.date === ko.date));
console.log('Weekday Overlaps:', overlaps.map(o => o.date));
