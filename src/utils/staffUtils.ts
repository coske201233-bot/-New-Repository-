/**
 * 名前の表記（トリミング、全角スペースなど）を統一し、比較を容易にします。
 * @param name スタッフ名
 * @returns 正規化された名前
 */
export const normalizeName = (name: string) => {
  if (!name || typeof name !== 'string') return '';
  // 1. 空白、タブ、改行、および一般的な記号（カッコ等）の除去
  let n = name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '');
  // 2. 漢字の表記ゆれ吸収
  n = n.replace(/條/g, '条');
  // 3. 特定の短縮名などを正規化（API/AutoAssignとの一貫性のため）
  if (n === '佐藤公') return '佐藤公貴';
  if (n === '藤森') return '藤森渓';
  if (n === '三井') return '三井諒';
  return n;
};

export const sortStaffByName = (staffList: any[]) => {
  return [...staffList].sort((a, b) => {
    const nameA = normalizeName(a.nameReading || a.name);
    const nameB = normalizeName(b.nameReading || b.name);
    return nameA.localeCompare(nameB, 'ja');
  });
};
