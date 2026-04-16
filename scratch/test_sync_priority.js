const { deduplicateRequests } = require('./src/utils/requestUtils');
const { normalizeName } = require('./src/utils/staffUtils');

// Mock staffUtils since we are running in node
jest.mock('./src/utils/staffUtils', () => ({
  normalizeName: (n) => n.trim()
}));

const testCases = [
  {
    name: 'Later updatedAt wins (PC vs Mobile)',
    data: [
      { id: '1', staffName: 'User A', date: '2026-05-01', type: 'Work', updatedAt: '2026-04-16T08:00:00Z', source: 'mobile' },
      { id: '2', staffName: 'User A', date: '2026-05-01', type: 'Off', updatedAt: '2026-04-16T08:01:00Z', source: 'web' }
    ],
    expectedId: '2'
  },
  {
    name: 'Later updatedAt wins (Mobile vs PC - within 10s)',
    data: [
      { id: '3', staffName: 'User B', date: '2026-05-02', type: 'Work', updatedAt: '2026-04-16T08:00:00Z', source: 'web' },
      { id: '4', staffName: 'User B', date: '2026-05-02', type: 'Off', updatedAt: '2026-04-16T08:00:05Z', source: 'mobile' }
    ],
    expectedId: '4'
  },
  {
    name: 'Later updatedAt wins (Legacy vs New)',
    data: [
      { id: '5', staffName: 'User C', date: '2026-05-03', type: 'Work', createdAt: '2026-04-16T07:00:00Z' },
      { id: '6', staffName: 'User C', date: '2026-05-03', type: 'Off', updatedAt: '2026-04-16T08:00:00Z' }
    ],
    expectedId: '6'
  }
];

testCases.forEach(tc => {
  const result = deduplicateRequests(tc.data);
  const winner = result.cleanList[0];
  if (winner && winner.id === tc.expectedId) {
    console.log(`✅ PASS: ${tc.name}`);
  } else {
    console.error(`❌ FAIL: ${tc.name} (Expected ID ${tc.expectedId}, got ${winner?.id})`);
  }
});
