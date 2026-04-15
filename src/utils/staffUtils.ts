/**
 * 名前の表記（トリミング、全角スペースなど）を統一し、比較を容易にします。
 * @param name スタッフ名
 * @returns 正規化された名前
 */
export const normalizeName = (name: string): string => {
  if (!name || typeof name !== 'string') return '';
  let n = name.replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '');
  // 旧字体・異体字の正規化（英字名移行後も互換性のため維持）
  n = n.replace(/條/g, '条').replace(/齊/g, '斉').replace(/齋/g, '斎');
  return n.toUpperCase(); // 比較のため大文字に統一
};

export const sortStaffByName = (staffList: any[]) => {
  return [...staffList].sort((a, b) => {
    const nameA = normalizeName(a.nameReading || a.name);
    const nameB = normalizeName(b.nameReading || b.name);
    return nameA.localeCompare(nameB, 'ja');
  });
};
