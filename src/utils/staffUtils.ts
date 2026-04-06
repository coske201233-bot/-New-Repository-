/**
 * 名前の表記（トリミング、全角スペースなど）を統一し、比較を容易にします。
 * @param name スタッフ名
 * @returns 正規化された名前
 */
export const normalizeName = (name: string) => {
  if (!name || typeof name !== 'string') return '';
  return name.trim().replace(/\u3000/g, ' ').replace(/\s+/g, ' ');
};

export const sortStaffByName = (staffList: any[]) => {
  return [...staffList].sort((a, b) => {
    const nameA = normalizeName(a.nameReading || a.name);
    const nameB = normalizeName(b.nameReading || b.name);
    return nameA.localeCompare(nameB, 'ja');
  });
};
