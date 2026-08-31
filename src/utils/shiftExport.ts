import { getMonthInfo, getDayType, normalizeDateStr } from './dateUtils';
import { normalizeName } from './staffUtils';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

export interface ShiftExportItem {
  staffId: string;
  staffName: string;
  profession: string;
  date: string;
  type: string;
  label: string;
  hours?: number | null;
  note?: string;
}

export interface MonthShiftMatrix {
  staff: any;
  days: {
    day: number;
    dateStr: string;
    dayType: 'weekday' | 'sat' | 'sun' | 'holiday';
    type: string;
    label: string;
    hours?: number | null;
    note?: string;
  }[];
}

/**
 * スタッフリストとシフト/申請データから、特定月の正規化済み勤務マトリックスを生成します。
 */
export const getNormalizedShiftMatrix = (
  staffList: any[],
  allDataPool: any[],
  year: number,
  monthIndex: number // 0-11
): MonthShiftMatrix[] => {
  const monthInfoArr = getMonthInfo(year, monthIndex) || [];
  const currentMonthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

  const listToExport = (staffList || []).filter(s => {
    if (!s) return false;
    const start = (s.leave_start_date || s.leaveStartDate || '').slice(0, 7).trim();
    const end = (s.leave_end_date || s.leaveEndDate || '').slice(0, 7).trim();
    const isLeavePeriod = (start && end) ? (start <= currentMonthKey && currentMonthKey <= end) : start ? (start <= currentMonthKey) : end ? (currentMonthKey <= end) : true;
    if ((s.status === '長期休暇' && isLeavePeriod) || s.status === '入職前' || s.status === '無効') return false;
    return true;
  });

  return listToExport.map(staff => {
    const staffId = String(staff.id || '').trim();
    const staffNameNormalized = normalizeName(staff.name || '');

    const days = monthInfoArr.filter((d: any) => !d.empty).map((d: any) => {
      const targetDateStr = normalizeDateStr(d.dateStr);
      const dDate = new Date(d.dateStr.replace(/-/g, '/'));
      const dtype = getDayType(dDate);

      // 対象スタッフ・対象日のレコードを抽出（削除・却下は除外）
      const matchedRecords = (allDataPool || []).filter((r: any) => {
        if (!r || !r.date) return false;
        if (r.status === 'deleted' || r.status === '削除' || r.status === 'rejected' || r.status === '却下') return false;
        if (normalizeDateStr(r.date) !== targetDateStr) return false;

        // 1. UUID照合
        const rStaffId = String(r.staff_id || r.staffId || r.user_id || r.userId || '').trim();
        if (staffId && rStaffId && rStaffId === staffId) return true;

        // 2. ID文字列からのUUID抽出照合
        const extractedId = r.id && typeof r.id === 'string' && r.id.includes('-') 
          ? (r.id.split('-').length >= 6 ? r.id.split('-').slice(1, 6).join('-') : null) 
          : null;
        if (staffId && extractedId && extractedId === staffId) return true;

        // 3. 名前照合
        const rName = normalizeName(r.staff_name || r.staffName || '');
        if (rName && rName === staffNameNormalized) return true;

        return false;
      });

      // 優先度判定ヘルパー
      const isManualEntry = (rec: any) => {
        if (!rec) return false;
        if (rec.is_manual === true || rec.isManual === true || rec.details?.isManual === true) return true;
        if (rec.is_manual === false || rec.isManual === false || rec.details?.isManual === false || rec.details?.isAuto === true) return false;
        const idStr = String(rec.id || '');
        return idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('req-');
      };

      const isApprovedEntry = (rec: any) => {
        if (!rec) return false;
        return rec.status === 'approved' || rec.status === '承認' || isManualEntry(rec);
      };

      const getTime = (rec: any) => {
        const t = rec.updatedAt || (rec.details && rec.details.updatedAt) || rec.updated_at || rec.createdAt || rec.created_at || 0;
        return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
      };

      matchedRecords.sort((a, b) => {
        const aMan = isManualEntry(a);
        const bMan = isManualEntry(b);
        if (aMan !== bMan) return aMan ? -1 : 1;

        const aApp = isApprovedEntry(a);
        const bApp = isApprovedEntry(b);
        if (aApp !== bApp) return aApp ? -1 : 1;

        return getTime(b) - getTime(a);
      });

      const req = matchedRecords[0] || null;

      let type = '';
      let label = '';

      if (req && req.type) {
        type = String(req.type).trim();
      } else {
        // データ未設定の日：平日は出勤、土日祝は公休
        type = (dtype === 'weekday') ? '出勤' : '公休';
      }

      if (type === '出勤' || type === '日勤') {
        label = '出';
      } else if (type === '公休') {
        label = '公';
      } else if (type === '年休' || type === '有給休暇' || type === '年給' || type === '有給') {
        label = '年';
      } else if (type === '特休') {
        label = req?.hours ? `特${req.hours}` : '特';
      } else if (type === '特休＋時間休') {
        const sp = req?.details?.specialHours ?? 0;
        const hr = req?.details?.hourlyHours ?? 0;
        label = `特${sp}時${hr}`;
      } else if (type === '振替＋時間休') {
        const hr = req?.details?.hourlyHours ?? (req?.hours ? Math.max(0, req.hours - 4) : 0);
        label = `振4時${hr}`;
      } else if (type === '夏季休暇') {
        label = '夏';
      } else if (type === '時間休' || type === '時間給') {
        label = req?.hours ? `時${req.hours}` : '時';
      } else if (type === '午前休' || type === '前休') {
        label = '前休';
      } else if (type === '午後休' || type === '後休') {
        label = '後休';
      } else if (type === '1日振替' || type === '半日振替' || type === '振替' || type === '振休') {
        label = '振';
      } else if (type === '看護休暇') {
        label = '看';
      } else if (type === '研修') {
        label = '研';
      } else if (type === '出張') {
        label = '張';
      } else if (type === '欠勤') {
        label = '欠';
      } else {
        label = type ? type.charAt(0) : '';
      }

      return {
        day: d.day,
        dateStr: targetDateStr,
        dayType: dtype,
        type,
        label,
        hours: req?.hours || null,
        note: req?.details?.note || ''
      };
    });

    return {
      staff,
      days
    };
  });
};

/**
 * 勤務実績マトリックスをCSV文字列に変換します
 */
export const generateShiftMatrixCSV = (matrix: MonthShiftMatrix[], year: number, monthIndex: number): string => {
  if (matrix.length === 0) return '';
  const daysInMonth = matrix[0].days;
  
  // Header: 氏名, 職種, 1日, 2日, ..., 31日
  const headerDays = daysInMonth.map(d => `${d.day}日`);
  const headerRow = ['氏名', '職種', ...headerDays].join(',');

  const rows = matrix.map(m => {
    const name = `"${(m.staff.name || '').replace(/"/g, '""')}"`;
    const profession = `"${(m.staff.jobType || m.staff.profession || '').replace(/"/g, '""')}"`;
    const dayValues = m.days.map(d => `"${(d.label || d.type || '').replace(/"/g, '""')}"`);
    return [name, profession, ...dayValues].join(',');
  });

  return [headerRow, ...rows].join('\r\n');
};
