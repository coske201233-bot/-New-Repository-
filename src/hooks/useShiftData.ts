import { useState, useCallback, useMemo } from 'react';
import { supabase } from '../utils/supabase';

export const useShiftData = () => {
  const [shifts, setShifts] = useState<any[]>([]);
  const [isLoadingShifts, setIsLoadingShifts] = useState(false);

  const fetchShifts = useCallback(async () => {
    setIsLoadingShifts(true);
    try {
      console.log('[ShiftEngine] Global fetch: データベースからシフトデータを取得中...');
      const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .limit(100000);
      
      if (error) throw error;
      
      // データが正常に取得できた場合のみ更新し、不用意に空にしない
      if (data) {
        // [V54.4] 重複排除と手動データ優先のロジックを実装
        // 1. 正規化（日勤 -> 出勤）
        const normalized = data.map(s => ({
          ...s,
          type: (s.type === '日勤') ? '出勤' : s.type
        }));

        // 2. 重複排除 (Staff + Date)
        const priorityMap = new Map<string, any>();
        const normalize = (name: string) => (name || '').replace(/[\s　]/g, '').replace(/公費/g, '').toUpperCase();
        
        const extractUuid = (idStr: string): string | null => {
          if (!idStr) return null;
          const parts = idStr.split('-');
          return parts.length >= 6 ? parts.slice(1, 6).join('-') : null;
        };

        normalized.forEach(s => {
          // IDまたは名前でキーを生成（同期漏れ対策）
          const extractedId = extractUuid(s.id);
          const sId = String(s.staff_id || s.user_id || extractedId || '').trim();
          const sName = normalize(s.staff_name || s.staffName || '');
          if ((!sId && !sName) || !s.date) return;
          
          const dateStr = String(s.date).substring(0, 10);
          const key = sId ? `${sId}_${dateStr}` : `name_${sName}_${dateStr}`;
          
          const existing = priorityMap.get(key);
          if (!existing) {
            priorityMap.set(key, s);
            return;
          }

          // 優先順位判定
          // A. 手動データは AI生成 より優先
          // [V57.3] is_manualカラムだけでなく、ID接頭辞 'm-' も判定に含める
          const isManualEntry = (rec: any) => 
            !!(rec.is_manual || rec.isManual) || 
            String(rec.id || '').startsWith('m-') || 
            String(rec.id || '').startsWith('req-');

          const existingIsManual = isManualEntry(existing);
          const newIsManual = isManualEntry(s);
          
          if (newIsManual && !existingIsManual) {
            priorityMap.set(key, s);
            return;
          }
          if (!newIsManual && existingIsManual) return; // 既存（手動）を維持

          // B. 種別優先度 (休み系 > 出勤系)
          const isOff = (t: string) => ['公休', '年休', '有給休暇', '夏季休暇', '特休', '休暇', '欠勤', '看護休暇', '研修'].includes(t);
          if (isOff(s.type) && !isOff(existing.type)) {
            priorityMap.set(key, s);
            return;
          }
        });

        const deduplicated = Array.from(priorityMap.values()).filter(s => {
          return true;
        });
        setShifts(deduplicated);
        console.log(`[ShiftEngine] Global fetch: ${deduplicated.length} unique records (Sanitized & Deduplicated)`);
      }
    } catch (e) {
      console.error('[ShiftEngine] Global fetch error:', e);
    } finally {
      setIsLoadingShifts(false);
    }
  }, []);

  return useMemo(() => ({
    shifts,
    setShifts,
    isLoadingShifts,
    fetchShifts
  }), [shifts, isLoadingShifts, fetchShifts]);
};
