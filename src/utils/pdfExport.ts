import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getDayType, normalizeDateStr } from './dateUtils';
import { normalizeName } from './staffUtils';

export const exportShiftToPDF = async (
  staffOrName: any, 
  requests: any[], 
  currentYear: number, 
  currentMonth: number
) => {
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const monthName = `${currentYear}年 ${currentMonth + 1}月`;
  
  const targetStaffId = typeof staffOrName === 'object' && staffOrName 
    ? String(staffOrName.id || staffOrName.staff_id || staffOrName.staffId || '').trim() 
    : '';
  const targetStaffName = typeof staffOrName === 'object' && staffOrName 
    ? String(staffOrName.name || '') 
    : String(staffOrName || '');
  const normalizedTargetName = normalizeName(targetStaffName);

  let rowsHtml = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(currentYear, currentMonth, d);
    const dateStr = normalizeDateStr(date);
    const dayName = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    const type = getDayType(date);
    
    // 申請・シフトデータから対象スタッフかつ対象日のレコードを抽出（削除・却下は除外）
    const allUserReqs = (Array.isArray(requests) ? requests : []).filter((r: any) => {
      if (!r || !r.date) return false;
      if (r.status === 'deleted' || r.status === '削除' || r.status === 'rejected' || r.status === '却下') return false;
      if (normalizeDateStr(r.date) !== dateStr) return false;

      // 1. UUID照合
      const rStaffId = String(r.staff_id || r.staffId || r.user_id || r.userId || '').trim();
      if (targetStaffId && rStaffId && rStaffId === targetStaffId) return true;

      // 2. ID文字列からのUUID抽出照合
      const extractedId = r.id && typeof r.id === 'string' && r.id.includes('-') 
        ? (r.id.split('-').length >= 6 ? r.id.split('-').slice(1, 6).join('-') : null) 
        : null;
      if (targetStaffId && extractedId && extractedId === targetStaffId) return true;

      // 3. 名前照合
      const rName = normalizeName(r.staff_name || r.staffName || '');
      if (rName && rName === normalizedTargetName) return true;

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

    // 最優先レコードを決定（手動優先 > 承認優先 > 最新更新日時優先）
    const sortedReqs = [...allUserReqs].sort((a, b) => {
      const aMan = isManualEntry(a);
      const bMan = isManualEntry(b);
      if (aMan !== bMan) return aMan ? -1 : 1;

      const aApp = isApprovedEntry(a);
      const bApp = isApprovedEntry(b);
      if (aApp !== bApp) return aApp ? -1 : 1;

      return getTime(b) - getTime(a);
    });

    const req = sortedReqs[0] || null;

    let statusText = '';
    let statusClass = 'status-work';

    if (req && req.type) {
      const rawType = String(req.type).trim();
      if (rawType === '出勤' || rawType === '日勤') {
        statusText = '出勤';
        statusClass = 'status-work';
      } else if (rawType === '特別出勤') {
        statusText = '特別出勤';
        statusClass = 'status-work';
      } else if (rawType === '公休') {
        statusText = '公休';
        statusClass = 'status-off';
      } else if (rawType === '年休' || rawType === '有給休暇' || rawType === '年給' || rawType === '有給') {
        statusText = '年休';
        statusClass = 'status-leave';
      } else if (rawType === '特休＋時間休') {
        const sp = req.details?.specialHours ?? 0;
        const hr = req.details?.hourlyHours ?? 0;
        statusText = `特休${sp}h＋時間休${hr}h`;
        statusClass = 'status-transfer';
      } else if (rawType === '振替＋時間休') {
        const hr = req.details?.hourlyHours ?? (req.hours ? Math.max(0, req.hours - 4) : 0);
        statusText = `振替4h＋時間休${hr}h`;
        statusClass = 'status-transfer';
      } else if (rawType === '振替4' || rawType === '振4') {
        statusText = '振4';
        statusClass = 'status-transfer';
      } else if (rawType === '特休') {
        const hrs = req.hours ? `${req.hours}h` : '';
        statusText = `特休${hrs}`;
        statusClass = 'status-special';
      } else if (rawType === '時間休' || rawType === '時間給') {
        const hrs = req.hours ? `${req.hours}h` : '';
        statusText = `時間休${hrs}`;
        statusClass = 'status-transfer';
      } else if (rawType === '午前休' || rawType === '午後休') {
        statusText = rawType;
        statusClass = 'status-transfer';
      } else if (rawType === '夏季休暇') {
        statusText = '夏季休暇';
        statusClass = 'status-summer';
      } else if (rawType === '振替' || rawType === '振休') {
        statusText = rawType;
        statusClass = 'status-transfer';
      } else if (rawType === '研修') {
        statusText = '研修';
        statusClass = 'status-special';
      } else if (rawType === '出張') {
        statusText = '出張';
        statusClass = 'status-work';
      } else if (rawType === '欠勤') {
        statusText = '欠勤';
        statusClass = 'status-off';
      } else {
        statusText = rawType;
        statusClass = 'status-off';
      }
    } else {
      // データ未設定の日：平日は出勤、土日祝は公休
      if (type === 'weekday') {
        statusText = '出勤';
        statusClass = 'status-work';
      } else {
        statusText = '公休';
        statusClass = 'status-off';
      }
    }

    // Style for holiday rows
    const rowClass = type === 'sat' ? 'sat-row' : (type === 'sun' || type === 'holiday') ? 'holiday-row' : '';

    rowsHtml += `
      <tr class="${rowClass}">
        <td>${d}日 (${dayName})</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>${req?.details?.note || ''}</td>
      </tr>
    `;
  }

  const html = `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Arial, sans-serif; padding: 20px; color: #1e293b; background-color: #fff; }
          h1 { color: #0f172a; border-left: 5px solid #38bdf8; padding-left: 15px; margin-bottom: 25px; font-size: 26px; }
          .header-info { margin-bottom: 30px; background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #f1f5f9; }
          .header-info p { margin: 8px 0; font-size: 16px; }
          table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 10px; border: 1px solid #f1f5f9; border-radius: 12px; overflow: hidden; }
          th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid #f1f5f9; }
          th { background-color: #f8fafc; color: #64748b; font-weight: bold; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom-width: 2px; }
          tr:last-child td { border-bottom: none; }
          .holiday-row { background-color: #fff1f2; }
          .sat-row { background-color: #f0f9ff; }
          .status-badge { padding: 4px 10px; border-radius: 100px; font-weight: bold; font-size: 12px; display: inline-block; }
          .status-work { background-color: #e0f2fe; color: #0369a1; }
          .status-off { background-color: #fef2f2; color: #dc2626; }
          .status-leave { background-color: #f0fdf4; color: #16a34a; }
          .status-special { background-color: #eff6ff; color: #2563eb; }
          .status-summer { background-color: #fefce8; color: #ca8a04; }
          .status-transfer { background-color: #f0f9ff; color: #b45309; border: 1.5px solid #facc15; }
          .footer { margin-top: 40px; font-size: 12px; color: #94a3b8; text-align: center; font-style: italic; }
        </style>
      </head>
      <body>
        <h1>出勤シフト表</h1>
        <div class="header-info">
          <p><strong>スタッフ氏名:</strong> ${targetStaffName}</p>
          <p><strong>対象期間:</strong> ${monthName}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>シフト</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <div class="footer">
          Generated by ShiftManager App
        </div>
      </body>
    </html>
  `;

  try {
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
  } catch (error) {
    console.error('PDF Export Error:', error);
    throw error;
  }
};
