const normalize = (name) => {
  if (!name || typeof name !== 'string') return '';
  let n = name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/條/g, '条');
  if (n === '佐藤公') return '佐藤公貴';
  if (n === '藤森') return '藤森渓';
  if (n === '三井') return '三井諒';
  if (n === '佐藤') return '佐藤晃';
  return n;
};

const isManualRecord = (r) => {
  if (!r) return false;
  const idStr = String(r.id || '');
  const type = String(r.type || r.shift_type || '').trim();
  const note = String(r.details?.note || r.note || '').trim();
  const reason = String(r.reason || '').trim();

  if (idStr.startsWith('m-') || idStr.startsWith('manual-')) return true;

  const isManualFlag = r.isManual === true || r.details?.isManual === true || r.is_manual === true;
  const isLockedFlag = r.locked === true || r.details?.locked === true;
  if (isManualFlag || isLockedFlag) return true;

  const leaveTypes = ['年休', '有給', '夏季', '休暇', '欠勤', '休業'];
  if (leaveTypes.some(lt => type.includes(lt))) return true;

  const isAutoId = idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-');
  if (isAutoId) {
    const hasHumanNote = note !== '' && !note.includes('自動');
    const hasHumanReason = reason !== '' && !reason.includes('自動');
    if (hasHumanNote || hasHumanReason) return true;
    return false;
  }

  if (type.includes('振替') || type.includes('公休')) return true;

  return true;
};

const testCases = [
  {
    name: "Manual ID (m-)",
    record: { id: "m-123", type: "出勤", staffName: "佐藤晃", date: "2026-06-15" },
    expected: true
  },
  {
    name: "Manual ID (manual-)",
    record: { id: "manual-456", type: "出勤", staffName: "佐藤晃", date: "2026-06-15" },
    expected: true
  },
  {
    name: "Locked Flag (Camel)",
    record: { id: "auto-123", type: "出勤", staffName: "佐藤晃", date: "2026-06-15", locked: true },
    expected: true
  },
  {
    name: "Locked Flag (Nested)",
    record: { id: "auto-123", type: "出勤", staffName: "佐藤晃", date: "2026-06-15", details: { locked: true } },
    expected: true
  },
  {
    name: "isManual Flag (Snake)",
    record: { id: "auto-123", type: "出勤", staffName: "佐藤晃", date: "2026-06-15", is_manual: true },
    expected: true
  },
  {
    name: "Leave Type (有給)",
    record: { id: "auto-123", type: "有給", staffName: "佐藤晃", date: "2026-06-15" },
    expected: true
  },
  {
    name: "Human Note (No '自動')",
    record: { id: "auto-123", type: "出勤", staffName: "佐藤晃", date: "2026-06-15", details: { note: "法事のため" } },
    expected: true
  },
  {
    name: "Pure Auto Record",
    record: { id: "auto-123", type: "出勤", staffName: "佐藤晃", date: "2026-06-15", details: { note: "自動割当(平日)" } },
    expected: false
  }
];

console.log("--- unit_test_is_manual.js ---");
let passCount = 0;
testCases.forEach(tc => {
  const result = isManualRecord(tc.record);
  const pass = result === tc.expected;
  if (pass) {
    console.log(`✅ PASS: ${tc.name}`);
    passCount++;
  } else {
    console.log(`❌ FAIL: ${tc.name} (Expected ${tc.expected}, got ${result})`);
  }
});

console.log(`\nScore: ${passCount}/${testCases.length}`);
if (passCount === testCases.length) {
  process.exit(0);
} else {
  process.exit(1);
}
