import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, TextInput, Alert, Modal, ActivityIndicator, SafeAreaView, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING } from '../theme/theme';
import { 
  ChevronRight, Database, FileOutput, 
  QrCode, X, Check, Shield, User, Save, LogOut, Edit3, Printer, FileText, UserPlus, Clock, XCircle, RefreshCw, History,
  BarChart2, TrendingUp, ChevronDown, ChevronUp, Award
} from 'lucide-react-native';
import { getMonthInfo, normalizeName, formatDate, getDayType, normalizeDateStr } from '../utils/dateUtils';
import { cloudStorage } from '../utils/cloudStorage';
import { supabase } from '../utils/supabase';
import { recordAuditLog } from '../utils/auditLogger';
import { AuditLogModal } from '../components/AuditLogModal';
import * as Print from 'expo-print';
import { generateMonthlyShifts } from '../utils/shiftEngine';
import { forceAppUpdate } from '../utils/appReloader';
import { calculateRemainingLeaveHours, formatRemainingLeave, getLeaveHoursPerDay, calculateUsedLeaveHours, calculateMandatoryLeaveStatus, calculateAnnualLeaveRate } from '../utils/leaveUtils';


interface AdminScreenProps {
  profile: any;
  setProfile: (p: any) => void;
  staffList: any[];
  setStaffList: (staff: any[] | ((prev: any[]) => any[])) => void;
  updateLimits: (type: string, val: number, monthStr?: string) => void;
  updatePassword: (pass: string) => void;
  adminPassword?: string;
  isAdminAuthenticated: boolean;
  setIsAdminAuthenticated: (auth: boolean) => void;
  monthlyLimits: any;
  onShareApp: () => void;
  onLogout: () => void;
  currentDate: Date;
  onAutoAssign: (year: number, month: number, limits: any) => Promise<void>;
  onUndoAutoAssign: () => Promise<void>;
  canUndoAutoAssign: boolean;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  updateStaffList: (update: any[] | ((prev: any[]) => any[])) => Promise<any>;
  patchStaff: (id: string, updates: any) => Promise<any>;
  fetchShifts?: () => Promise<void>;
  onNavigateToStaff?: () => void;
  shifts?: any[];
}

export const AdminScreen: React.FC<AdminScreenProps> = ({
  profile, setProfile, staffList = [], setStaffList,
  updateLimits, updatePassword, monthlyLimits = {}, adminPassword, onShareApp,
  currentDate = new Date(), onAutoAssign, onUndoAutoAssign, canUndoAutoAssign, isAdminAuthenticated, setIsAdminAuthenticated, onLogout, requests = [], setRequests,
  updateStaffList, patchStaff, fetchShifts, onNavigateToStaff, shifts = []
}) => {

  const [editStaff, setEditStaff] = useState<any>(null);
  const [showStaffEditModal, setShowStaffEditModal] = useState(false);
  const [showAuditLogModal, setShowAuditLogModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editJobType, setEditJobType] = useState('');
  const [editPlacement, setEditPlacement] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editStatus, setEditStatus] = useState('常勤');
  const [editNoHoliday, setEditNoHoliday] = useState(false);
  const [editPermissions, setEditPermissions] = useState(['スタッフ']);
  
  const [isAssigning, setIsAssigning] = useState(false);
  const [isUpdatingApp, setIsUpdatingApp] = useState(false);

  // 年休取得率集計モーダル・表示用ステート
  const [showLeaveStatsModal, setShowLeaveStatsModal] = useState(false);
  const [leaveStatsSort, setLeaveStatsSort] = useState<'rate_asc' | 'rate_desc' | 'name'>('rate_asc');

  // 全シフト＋リクエストデータ
  const allCalendarData = React.useMemo(() => {
    return [...(Array.isArray(requests) ? requests : []), ...(Array.isArray(shifts) ? shifts : [])];
  }, [requests, shifts]);

  // スタッフごとの年休取得率集計一覧（管理者閲覧専用）
  const staffLeaveStatsList = React.useMemo(() => {
    if (!Array.isArray(staffList)) return [];

    return staffList
      .filter(s => {
        if (!s || s.status === '無効' || s.status === '入職前') return false;
        return true;
      })
      .map(s => {
        // 付与日数の取得 (localStorage または DB値)
        const getStaffInitDays = () => {
          const uKey1 = `initial_leave_days_${s?.id}`;
          const uKey2 = `initial_leave_days_${s?.email}`;
          const uKey3 = `initial_leave_days_${s?.name}`;
          if (typeof window !== 'undefined') {
            const s1 = localStorage.getItem(uKey1);
            const s2 = localStorage.getItem(uKey2);
            const s3 = localStorage.getItem(uKey3);
            if (s1 !== null && !isNaN(parseFloat(s1))) return parseFloat(s1);
            if (s2 !== null && !isNaN(parseFloat(s2))) return parseFloat(s2);
            if (s3 !== null && !isNaN(parseFloat(s3))) return parseFloat(s3);
          }
          const raw = s?.initial_leave_days ?? s?.initialLeaveDays;
          return (raw !== undefined && raw !== null && !isNaN(Number(raw))) ? Number(raw) : 0;
        };

        const staffPos = s?.position || s?.role || '';
        const grantDays = getStaffInitDays();
        const hoursPerDay = getLeaveHoursPerDay(staffPos);
        
        // 既存の残年休計算
        const remLeaveHours = calculateRemainingLeaveHours(grantDays, allCalendarData, s, staffPos);
        const remLeaveDays = Math.round((remLeaveHours / hoursPerDay) * 10) / 10;
        const formattedRemStr = formatRemainingLeave(remLeaveHours, staffPos);

        // 取得日数（Used Days = 付与日数 - 残年休）
        const rawUsedDays = Math.max(0, grantDays - (remLeaveHours / hoursPerDay));
        const usedDays = Math.round(rawUsedDays * 10) / 10;

        // 年休取得率 (%)
        let ratePercent = 0;
        let rateStr = '-';
        if (grantDays > 0) {
          ratePercent = Math.round((rawUsedDays / grantDays) * 1000) / 10;
          rateStr = `${ratePercent.toFixed(1)}%`;
        } else {
          ratePercent = 0;
          rateStr = '0.0%';
        }

        // 5日必修化ステータス
        const mStatus = calculateMandatoryLeaveStatus(s, allCalendarData, (currentDate || new Date()).getFullYear());

        // 消化状況に応じたカラーリング (70%以上=#34d399, 40%以上=#38bdf8, 20%以上=#f59e0b, 20%未満=#f87171)
        let statusColor = '#f87171'; // 遅れ/低進捗（ローズ）
        if (ratePercent >= 70 || mStatus.isCompleted) {
          statusColor = '#34d399'; // 順調・高消化（グリーン）
        } else if (ratePercent >= 40) {
          statusColor = '#38bdf8'; // スカイブルー
        } else if (ratePercent >= 20) {
          statusColor = '#f59e0b'; // アンバー
        }

        const formattedUsedDays = usedDays % 1 === 0 ? usedDays.toFixed(0) : usedDays.toFixed(1);
        const formattedGrantDays = grantDays % 1 === 0 ? grantDays.toFixed(0) : grantDays.toFixed(1);
        const formattedRemDays = remLeaveDays % 1 === 0 ? remLeaveDays.toFixed(0) : remLeaveDays.toFixed(1);

        const displayText = `取得 ${formattedUsedDays}日 / 付与 ${formattedGrantDays}日（残 ${formattedRemDays}日）`;

        return {
          staff: s,
          grantDays,
          usedDays,
          remLeaveHours,
          remLeaveDays,
          formattedRemStr,
          ratePercent,
          rateStr,
          statusColor,
          mStatus,
          displayText,
        };
      });
  }, [staffList, allCalendarData, currentDate]);

  // 年休取得状況集計表のA4印刷ハンドラー
  const handlePrintLeaveStatsReport = () => {
    if (Platform.OS !== 'web') return;

    try {
      const year = (currentDate || new Date()).getFullYear();
      let rowsHtml = '';
      
      const sortedList = [...staffLeaveStatsList].sort((a, b) => {
        if (leaveStatsSort === 'rate_asc') return a.ratePercent - b.ratePercent;
        if (leaveStatsSort === 'rate_desc') return b.ratePercent - a.ratePercent;
        return (a.staff.name || '').localeCompare(b.staff.name || '');
      });

      sortedList.forEach((item, index) => {
        const s = item.staff;
        const statusText = item.mStatus.isCompleted 
          ? '<span style="color:#16a34a; font-weight:bold;">5日達成済</span>' 
          : `<span style="color:#dc2626; font-weight:bold;">${item.mStatus.displayText}</span>`;

        const formattedUsed = item.usedDays % 1 === 0 ? item.usedDays.toFixed(0) : item.usedDays.toFixed(1);
        const formattedGrant = item.grantDays % 1 === 0 ? item.grantDays.toFixed(0) : item.grantDays.toFixed(1);
        const formattedRem = item.remLeaveDays % 1 === 0 ? item.remLeaveDays.toFixed(0) : item.remLeaveDays.toFixed(1);

        rowsHtml += `
          <tr>
            <td>${index + 1}</td>
            <td style="text-align: left; padding-left: 8px; font-weight: bold;">${s.name}</td>
            <td>${s.jobType || s.profession || '-'}</td>
            <td>${s.placement || s.department || '-'}</td>
            <td style="font-weight: bold;">${formattedGrant}日</td>
            <td style="font-weight: bold; color: #0284c7;">${formattedUsed}日</td>
            <td>${formattedRem}日 (${item.formattedRemStr})</td>
            <td style="font-weight: bold; color: ${item.ratePercent >= 70 ? '#16a34a' : (item.ratePercent >= 40 ? '#0284c7' : '#ea580c')};">${item.rateStr}</td>
            <td>${statusText}</td>
          </tr>
        `;
      });

      const html = `
        <html>
          <head>
            <title>年休取得率・消化状況集計表（${year}年度）</title>
            <style>
              @page { size: A4 portrait; margin: 10mm; }
              body { font-family: sans-serif; padding: 10px; color: #1e293b; }
              .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; border-bottom: 2px solid #0284c7; padding-bottom: 6px; }
              table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #cbd5e1; }
              th, td { border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center; font-size: 11px; }
              th { background-color: #f1f5f9; font-weight: bold; }
              tr:nth-child(even) { background-color: #f8fafc; }
              .summary { margin-top: 12px; font-size: 11px; color: #64748b; }
            </style>
          </head>
          <body>
            <div class="header">
              <div>
                <h1 style="margin:0; font-size:18px;">職員 年休取得率・消化状況集計表</h1>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">集計年度: ${year}年度（管理者閲覧専用）</div>
              </div>
              <div style="font-size: 11px;">印刷日: ${new Date().toLocaleDateString('ja-JP')}</div>
            </div>
            <table>
              <thead>
                <tr>
                  <th style="width: 30px;">No</th>
                  <th style="width: 100px;">氏名</th>
                  <th style="width: 60px;">職種</th>
                  <th style="width: 70px;">所属</th>
                  <th style="width: 60px;">付与日数</th>
                  <th style="width: 60px;">取得日数</th>
                  <th style="width: 100px;">残年休</th>
                  <th style="width: 75px;">年休取得率</th>
                  <th style="width: 85px;">5日必修状況</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            <div class="summary">
              ※取得日数 = 付与日数 - 残年休（日数換算） / 年休取得率(%) = (取得日数 / 付与日数) × 100
            </div>
            <script>window.onload=function(){window.print();};<\/script>
          </body>
        </html>
      `;

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        Alert.alert('ポップアップ制限', 'ブラウザのポップアップ設定を許可してください。');
      }
    } catch (err) {
      console.error('Print logic error:', err);
      Alert.alert('エラー', '年休集計表の生成中に問題が発生しました。');
    }
  };
 
  // [CRITICAL VERSION 49.0] 自動管理者認証バイパス
  React.useEffect(() => {
    const isPowerUser = profile?.role === 'admin' || profile?.role === '管理者' || profile?.role === '開発者' || profile?.is_admin === true;
    if (isPowerUser && !isAdminAuthenticated) {
      console.log('--- [AUTO_ADMIN] Role-based bypass activated for:', profile.name);
      setIsAdminAuthenticated(true);
    }
  }, [profile, isAdminAuthenticated]);

  // Safeguard: Ensure currentDate exists
  const safeDate = currentDate || new Date();
  const currentYear = safeDate.getFullYear();
  const currentMonth = safeDate.getMonth();
  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const limits = (monthlyLimits && monthlyLimits[currentMonthStr]) || { weekday: 12, sat: 1, sun: 0, pub: 1 };

  // --- Approvals Filtering with safeguards and logical fixes ---
  const pendingRequests = Array.isArray(requests) ? requests.filter(r => {
    if (!r || r.status === 'deleted' || r.status === '削除' || r.status === 'rejected' || r.status === '却下') return false;
    const isApproved = r.status === 'approved' || r.status === '承認' || r.is_manual === true || r.isManual === true;
    return !isApproved && (r.status === 'pending' || r.status === '申請中' || !r.status);
  }) : [];

  // --- Constant Options (Custom Hospital Structure) ---
  const PROFESSION_OPTS = ['PT', 'OT', 'ST', '助手'];
  const PLACEMENT_OPTS = ['２F', '包括', '4F', '外来', 'フォロー', '兼務', '管理', '事務', '排尿管理', '訪問リハ'];
  const POSITION_OPTS = ['科長', '科長補佐', '係長', '主査', '主任', '主事', '会計年度'];
  const STATUS_OPTS = ['常勤', '時短勤務', '長期休暇', 'その他'];
  const HOLIDAY_SETTING_OPTS = [{ label: '設定なし', value: false }, { label: '土日祝休み', value: true }];
  const ROLE_OPTS = [{ label: '一般スタッフ', value: ['スタッフ'] }, { label: 'シフト管理者', value: ['管理者', 'スタッフ'] }];

  // --- Handlers ---

  const handleApproveRequest = async (req: any) => {
    try {
      const updatedReq = { ...req, status: 'approved' };
      setRequests(prev => prev.map(r => r.id === req.id ? updatedReq : r));
      await cloudStorage.upsertRequests([updatedReq]);

      // 監査ログ記録
      await recordAuditLog({
        operatorId: profile?.id,
        operatorName: profile?.name || '管理者',
        targetStaffId: req.staff_id || req.staffId,
        targetStaffName: req.staff_name || req.staffName,
        actionType: 'REQUEST_APPROVE',
        targetDate: req.date,
        details: `${req.staff_name || req.staffName || 'スタッフ'}さんの申請「${req.type || '申請'}」(${req.date}) を承認しました`,
        beforeData: req,
        afterData: updatedReq,
      });

      Alert.alert('完了', '申請を承認しました。');
    } catch (error: any) {
      console.error("UPDATE ERROR:", error);
      Alert.alert("保存に失敗しました", (error.message || "不明なエラー") + "\n" + (error.details || ""));
    }
  };

  const handleRejectRequest = async (id: string) => {
    try {
      const targetReq = requests.find(r => r.id === id);
      // 物理削除を実行
      await cloudStorage.deleteRequest(id);
      setRequests(prev => prev.filter(r => r.id !== id));

      // 監査ログ記録
      if (targetReq) {
        await recordAuditLog({
          operatorId: profile?.id,
          operatorName: profile?.name || '管理者',
          targetStaffId: targetReq.staff_id || targetReq.staffId,
          targetStaffName: targetReq.staff_name || targetReq.staffName,
          actionType: 'REQUEST_REJECT',
          targetDate: targetReq.date,
          details: `${targetReq.staff_name || targetReq.staffName || 'スタッフ'}さんの申請「${targetReq.type || '申請'}」(${targetReq.date}) を却下・削除しました`,
          beforeData: targetReq,
          afterData: null,
        });
      }

      Alert.alert('完了', '申請を却下し、削除しました。');
    } catch (e) {
      console.error('Reject error:', e);
      Alert.alert('エラー', '却下処理中にエラーが発生しました。');
    }
  };

  const handlePrintAttendanceReport = () => {
    if (Platform.OS !== 'web') return;
    
    try {
      // データの準備
      const year = currentYear;
      const month = currentMonth + 1;
      const monthInfoArr = getMonthInfo(year, currentMonth) || [];
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
      
      // ヘッダー
      let headerHtml = '<th style="width: 80px;">氏名</th><th style="width: 40px;">職種</th>';
      monthInfoArr.forEach((d: any) => {
        if (!d.empty) {
          const dDate = new Date(d.dateStr.replace(/-/g, '/'));
          const dayIdx = isNaN(dDate.getTime()) ? 0 : dDate.getDay();
          const style = (d.isH || dayIdx === 0) ? 'color: #ef4444; background-color: #fef2f2;' : (dayIdx === 6 ? 'color: #3b82f6; background-color: #eff6ff;' : '');
          headerHtml += `<th style="${style}">${d.day}<br/><small>${dayNames[dayIdx]}</small></th>`;
        }
      });

      // 行データ
      let rowsHtml = '';
      // 長期休暇・入職前のスタッフのみ除外
      const listToPrint = staffList.filter(s => {
        const start = (s.leave_start_date || s.leaveStartDate || '').slice(0, 7).trim();
        const end = (s.leave_end_date || s.leaveEndDate || '').slice(0, 7).trim();
        const isLeavePeriod = (start && end) ? (start <= currentMonthKey && currentMonthKey <= end) : start ? (start <= currentMonthKey) : end ? (currentMonthKey <= end) : true;
        if ((s.status === '長期休暇' && isLeavePeriod) || s.status === '入職前') return false;
        return true;
      });

      // requests と shifts を統合した全データプール
      const allDataPool = [...(Array.isArray(requests) ? requests : []), ...(Array.isArray(shifts) ? shifts : [])];

      listToPrint.forEach(s => {
        let row = `<tr><td style="text-align: left; padding-left: 5px; font-weight: bold;">${s.name}</td><td>${s.jobType || s.profession || ''}</td>`;
        monthInfoArr.forEach((d: any) => {
          if (!d.empty) {
            const staffId = String(s.id || '').trim();
            const staffNameNormalized = normalizeName(s.name);
            const targetDateStr = normalizeDateStr(d.dateStr);

            // 対象スタッフ・対象日のレコードを抽出（削除・却下は除外）
            const matchedRecords = allDataPool.filter((r: any) => {
              if (!r || !r.date) return false;
              if (r.status === 'deleted' || r.status === '削除' || r.status === 'rejected' || r.status === '却下') return false;
              if (normalizeDateStr(r.date) !== targetDateStr) return false;

              // 1. UUID / staff_id / user_id による直接照合
              const rStaffId = String(r.staff_id || r.staffId || r.user_id || r.userId || '').trim();
              if (staffId && rStaffId && rStaffId === staffId) return true;

              // 2. ID文字列からのUUID抽出照合 (例: m-UUID-DATE-...)
              const extractedId = r.id && typeof r.id === 'string' && r.id.includes('-') 
                ? (r.id.split('-').length >= 6 ? r.id.split('-').slice(1, 6).join('-') : null) 
                : null;
              if (staffId && extractedId && extractedId === staffId) return true;

              // 3. 名前による照合
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

            const getRecTime = (rec: any) => {
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

              return getRecTime(b) - getRecTime(a);
            });

            const req = matchedRecords[0] || null;

            let type = '';
            const dDate = new Date(d.dateStr.replace(/-/g, '/'));
            const dtype = getDayType(dDate);

            if (req && req.type) {
              type = String(req.type).trim();
            } else {
              // データ未設定の日：平日はデフォルト「出勤」、土日祝はデフォルト「公休」
              type = (dtype === 'weekday') ? '出勤' : '公休';
            }

            // 種別ごとにスタイルと略称を決定
            let cellStyle = '';
            let label = '';

            if (type === '出勤' || type === '日勤') {
              cellStyle = 'background-color: #ffffff; color: #1e293b; font-weight: bold;';
              label = '出';
            } else if (type === '公休') {
              cellStyle = 'background-color: #fef2f2; color: #dc2626;';
              label = '公';
            } else if (type === '年休' || type === '有給休暇' || type === '年給' || type === '有給') {
              cellStyle = 'background-color: #f0fdf4; color: #16a34a; font-weight: bold;';
              label = '年';
            } else if (type === '特休') {
              cellStyle = 'background-color: #eff6ff; color: #2563eb; font-weight: bold;';
              const hrs = req?.hours ? `${req.hours}` : '';
              label = `特${hrs}`;
            } else if (type === '特休＋時間休') {
              cellStyle = 'background-color: #eff6ff; color: #2563eb; font-weight: bold;';
              const spHrs = req?.details?.specialHours ?? 0;
              const hrHrs = req?.details?.hourlyHours ?? 0;
              label = `特${spHrs}時${hrHrs}`;
            } else if (type === '振替＋時間休') {
              cellStyle = 'background-color: #eff6ff; color: #2563eb; font-weight: bold;';
              const hrHrs = req?.details?.hourlyHours ?? (req?.hours ? Math.max(0, req.hours - 4) : 0);
              label = `振4時${hrHrs}`;
            } else if (type === '振替4' || type === '振4') {
              cellStyle = 'background-color: #eff6ff; color: #2563eb; font-weight: bold;';
              label = '振4';
            } else if (type === '夏季休暇') {
              cellStyle = 'background-color: #fefce8; color: #ca8a04;';
              label = '夏';
            } else if (type === '時間休' || type === '時間給') {
              cellStyle = 'background-color: #f0fdf4; color: #16a34a;';
              const hrs = req?.hours ? `${req.hours}` : '';
              label = `時${hrs}`;
            } else if (type === '午前休' || type === '前休') {
              cellStyle = 'background-color: #eff6ff; color: #2563eb; font-weight: bold;';
              label = '前休';
            } else if (type === '午後休' || type === '後休') {
              cellStyle = 'background-color: #eff6ff; color: #2563eb; font-weight: bold;';
              label = '後休';
            } else if (type === '1日振替' || type === '半日振替' || type === '振替' || type === '振休') {
              cellStyle = 'background-color: #eff6ff; color: #2563eb; font-weight: bold;';
              label = '振';
            } else if (type === '研修') {
              cellStyle = 'background-color: #f5f3ff; color: #7c3aed; font-weight: bold;';
              label = '研';
            } else if (type === '出張') {
              cellStyle = 'background-color: #eff6ff; color: #2563eb; font-weight: bold;';
              label = '張';
            } else if (type === '欠勤') {
              cellStyle = 'background-color: #fff7ed; color: #ea580c;';
              label = '欠';
            } else {
              cellStyle = 'background-color: #f8fafc; color: #64748b;';
              label = type ? type.charAt(0) : '';
            }

            row += `<td style="${cellStyle}">${label}</td>`;
          }
        });
        row += '</tr>';
        rowsHtml += row;
      });

      const legendHtml = `
        <div style="display:flex; gap:16px; margin-top:8px; font-size:10px; flex-wrap:wrap;">
          <span><span style="display:inline-block;width:14px;height:14px;background:#ffffff;border:1px solid #94a3b8;vertical-align:middle;margin-right:3px;"></span>出 = 出勤</span>
          <span><span style="display:inline-block;width:14px;height:14px;background:#fef2f2;border:1px solid #94a3b8;vertical-align:middle;margin-right:3px;"></span>公 = 公休</span>
          <span><span style="display:inline-block;width:14px;height:14px;background:#f0fdf4;border:1px solid #94a3b8;vertical-align:middle;margin-right:3px;"></span>年 = 年休</span>
          <span><span style="display:inline-block;width:14px;height:14px;background:#eff6ff;border:1px solid #94a3b8;vertical-align:middle;margin-right:3px;"></span>特 = 特休</span>
          <span><span style="display:inline-block;width:14px;height:14px;background:#fefce8;border:1px solid #94a3b8;vertical-align:middle;margin-right:3px;"></span>夏 = 夏季休暇</span>
          <span><span style="display:inline-block;width:14px;height:14px;background:#f0fdf4;border:1px solid #94a3b8;vertical-align:middle;margin-right:3px;"></span>時 = 時間休</span>
          <span><span style="display:inline-block;width:14px;height:14px;background:#eff6ff;border:1px solid #94a3b8;vertical-align:middle;margin-right:3px;"></span>振 = 振替</span>
          <span><span style="display:inline-block;width:14px;height:14px;background:#eff6ff;border:1px solid #94a3b8;vertical-align:middle;margin-right:3px;"></span>前休/後休 = 午前休/午後休</span>
          <span><span style="display:inline-block;width:14px;height:14px;background:#eff6ff;border:1px solid #94a3b8;vertical-align:middle;margin-right:3px;"></span>特○時○ / 振4時○ = 複合休</span>
        </div>
      `;

      const html = `
        <html>
          <head>
            <title>勤務実績表</title>
            <style>
              @page { size: A4 landscape; margin: 5mm; }
              body { font-family: sans-serif; padding: 10px; color: #1e293b; }
              .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6px; border-bottom: 2px solid #38bdf8; padding-bottom: 5px; }
              table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 2px solid #334155; }
              th, td { border: 1px solid #94a3b8; padding: 2px 1px; text-align: center; font-size: 9px; }
              th { background-color: #f1f5f9; font-weight: bold; }
              td { height: 22px; }
              .legend { font-size: 10px; margin-top: 8px; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1 style="margin:0; font-size:18px;">勤務実績表（${year}年${month}月）</h1>
              <div style="font-size: 11px;">印刷日: ${new Date().toLocaleDateString('ja-JP')}</div>
            </div>
            <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
            ${legendHtml}
            <script>window.onload=function(){window.print();};<\/script>
          </body>
        </html>
      `;

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        Alert.alert('ポップアップ制限', 'ブラウザのポップアップ設定を許可してください。');
      }
    } catch (err) {
      console.error('Print logic error:', err);
      Alert.alert('エラー', 'データの生成中に問題が発生しました。');
    }
  };

  const DropdownSelector = ({ label, value, options, onSelect, style }: any) => {
    const [isVisible, setIsVisible] = useState(false);
    const displayValue = typeof value === 'boolean' 
      ? (options.find((o:any) => o.value === value)?.label || 'なし')
      : (Array.isArray(value) ? (options.find((o:any) => JSON.stringify(o.value) === JSON.stringify(value))?.label || value[0]) : value);
    const isSimpleArray = options.length > 0 && typeof options[0] !== 'object';
    return (
      <View style={[{ marginBottom: 16 }, style]}>
        <ThemeText bold style={{ marginBottom: 8, fontSize: 13, color: COLORS.textSecondary }}>{label}</ThemeText>
        <TouchableOpacity style={styles.dropdownBtn} onPress={() => setIsVisible(true)}><ThemeText bold color="white">{typeof value === 'number' ? value : (displayValue || '未選択')}</ThemeText><ChevronRight size={18} color={COLORS.textSecondary} /></TouchableOpacity>
        <Modal visible={isVisible} transparent animationType="fade">
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsVisible(false)}>
            <View style={styles.pickerContainer}>
              <View style={styles.pickerHeader}><ThemeText bold variant="h2">{label}</ThemeText><TouchableOpacity onPress={() => setIsVisible(false)}><X size={24} color={COLORS.textSecondary} /></TouchableOpacity></View>
              <ScrollView>{options.map((opt: any) => {
                const optVal = isSimpleArray ? opt : (typeof opt === 'number' ? opt : opt.value);
                const optLabel = isSimpleArray ? (typeof opt === 'number' ? `${opt}人` : opt) : opt.label;
                const isActive = typeof optVal === 'object' ? JSON.stringify(optVal) === JSON.stringify(value) : (typeof value === 'number' ? optVal === value : optVal === value);
                return (
                  <TouchableOpacity key={String(optLabel)} style={[styles.pickerItem, isActive && styles.pickerItemActive]} onPress={() => { onSelect(optVal); setIsVisible(false); }}>
                    <ThemeText bold={isActive} color={isActive ? '#38bdf8' : 'white'} style={{ fontSize: 18 }}>{optLabel}</ThemeText>
                    {isActive && <Check size={20} color="#38bdf8" />}
                  </TouchableOpacity>
                );
              })}</ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  };










  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><ThemeText variant="h1">設定 [V76.6]</ThemeText><ThemeText variant="caption" style={{ fontSize: 9, opacity: 0.3, color: COLORS.textSecondary }}>[BUILD: VERSION 76.6 - BULLETPROOF SYNC]</ThemeText></View>
      <ScrollView style={{ flex: 1 }}>
        <View style={{ padding: SPACING.md }}>



          {isAdminAuthenticated ? (
            <View style={{ marginTop: 24 }}>

              <ThemeText bold style={{ color: '#ef4444', marginBottom: 12, marginTop: 12 }}>🔔 承認が必要な申請</ThemeText>
              


              {pendingRequests.length > 0 ? (
                <View style={{ marginBottom: 16 }}>
                  <ThemeText variant="caption" bold color={COLORS.textSecondary} style={{marginBottom:8}}>📅 休暇・休日申請の承認待ち ({pendingRequests.length}件)</ThemeText>
                  {pendingRequests.map(r => (
                    <ThemeCard key={r.id} style={styles.approvalItem}>
                      <View style={{ flex: 1 }}><ThemeText bold>{r.staffName}</ThemeText><ThemeText variant="caption" color={COLORS.textSecondary}>{formatDate(r.date)} | {r.type} {r.hours ? `(${r.hours}h)` : ''}</ThemeText></View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity style={[styles.miniApproveBtn, {backgroundColor: '#38bdf8'}]} onPress={() => handleApproveRequest(r)}><Check size={16} color="white" /></TouchableOpacity>
                        <TouchableOpacity style={[styles.miniApproveBtn, {backgroundColor: 'rgba(255,255,255,0.05)'}]} onPress={() => handleRejectRequest(r.id)}><X size={16} color={COLORS.textSecondary} /></TouchableOpacity>
                      </View>
                    </ThemeCard>
                  ))}
                </View>
              ) : null}

              {pendingRequests.length === 0 ? (
                <ThemeCard style={{ padding: 20, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', marginBottom: 20 }}>
                  <ThemeText color={COLORS.textSecondary}>現在、承認待ちの申請はありません</ThemeText>
                </ThemeCard>
              ) : null}

              <ThemeText bold style={{ color: COLORS.textSecondary, marginBottom: 12, marginTop: 12 }}>📋 レポーティング & ツール</ThemeText>
              
              <ThemeCard style={styles.itemRow}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.1)' }]}><UserPlus size={20} color="#38bdf8" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>スタッフ管理・アカウント設定</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>新規スタッフ登録、パスワード変更、権限・所属設定、無効化</ThemeText>
                </View>
                <TouchableOpacity style={styles.inlineBtn} onPress={onNavigateToStaff}>
                  <ThemeText bold color="#38bdf8" style={{marginRight:4}}>管理画面を開く</ThemeText>
                  <ChevronRight size={16} color="#38bdf8" />
                </TouchableOpacity>
              </ThemeCard>

              <ThemeCard style={styles.itemRow}>
                <View style={styles.iconCircle}><FileText size={20} color="#10b981" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>全職員の勤務実績表</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>{currentMonth + 1}月分の全スタッフ一覧表（A4横印刷用）</ThemeText>
                </View>
                <TouchableOpacity style={styles.inlineBtn} onPress={handlePrintAttendanceReport}>
                  <Printer size={18} color="#38bdf8" /><ThemeText bold color="#38bdf8" style={{marginLeft:6}}>生成</ThemeText>
                </TouchableOpacity>
              </ThemeCard>

              <ThemeCard style={styles.itemRow}>
                <View style={styles.iconCircle}><Clock size={20} color="#38bdf8" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>シフト自動割り当て</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>{currentMonth + 1}月の残り枠を自動的に埋めます</ThemeText>
                </View>
                <TouchableOpacity 
                  style={[styles.inlineBtn, { backgroundColor: 'rgba(56, 189, 248, 0.1)' }, isAssigning && { opacity: 0.5 }]} 
                  onPress={async () => {
                    console.log('[AdminScreen] 「自動生成」ボタンが押されました。');
                    setIsAssigning(true);
                    try {
                      console.log('[AdminScreen] シフト生成開始: ' + currentYear + '年' + (currentMonth + 1) + '月');
                      
                      const result = await generateMonthlyShifts(currentYear, currentMonth + 1, {
                        weekdayCap: limits.weekday,
                        satCap: limits.sat,
                        sunCap: limits.sun,
                        holidayCap: limits.pub
                      });
                      
                      console.log('[AdminScreen] シフト生成完了。レコード数: ' + (result?.length || 0));
                      Alert.alert('完了', 'シフトの自動割り当てが完了しました。');

                      // グローバルなシフトステートを最新化
                      if (fetchShifts) {
                        console.log('[AdminScreen] 全体ステートをリフレッシュ中...');
                        await fetchShifts();
                      }
                      
                      // ターゲット月の旧自動生成リクエスト（UI用）をパージ
                      const monthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
                      setRequests((prev: any[]) => prev.filter(
                        r => !(String(r.id || '').startsWith('auto-') && r.date && r.date.startsWith(monthPrefix))
                      ));

                    } catch (e: any) {
                      console.error('[AdminScreen] 自動割り当てエラー:', e);
                      Alert.alert(
                        'エラーが発生しました',
                        'シフト生成中に問題が発生しました。\n\n' + (e.message || '不明なエラー')
                      );
                    } finally {
                      setIsAssigning(false);
                      console.log('[AdminScreen] 処理終了 (Loading state cleared)');
                    }
                  }}
                  disabled={isAssigning}
                >
                  {isAssigning ? (
                    <ActivityIndicator size="small" color="#38bdf8" />
                  ) : (
                    <>
                      <Database size={18} color="#38bdf8" />
                      <ThemeText bold color="#38bdf8" style={{marginLeft:6}}>実行</ThemeText>
                    </>
                  )}
                </TouchableOpacity>


                {canUndoAutoAssign && !isAssigning && (
                  <TouchableOpacity 
                    style={[styles.inlineBtn, { backgroundColor: 'rgba(239, 68, 68, 0.1)', marginLeft: 8 }]} 
                    onPress={onUndoAutoAssign}
                  >
                    <ThemeText bold color="#ef4444">1つ戻す</ThemeText>
                  </TouchableOpacity>
                )}
              </ThemeCard>


              <ThemeCard style={styles.itemRow}>
                <View style={styles.iconCircle}><QrCode size={20} color="#f59e0b" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>アプリ配布用QRコード</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>スタッフにアプリを配布するためのQRコードを表示します</ThemeText>
                </View>
                <TouchableOpacity style={[styles.inlineBtn, { backgroundColor: 'rgba(245, 158, 11, 0.1)' }]} onPress={onShareApp}>
                  <ThemeText bold color="#f59e0b">表示</ThemeText>
                </TouchableOpacity>
              </ThemeCard>

              <ThemeCard style={styles.itemRow}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(168, 85, 247, 0.1)' }]}>
                  <History size={20} color="#a855f7" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>操作履歴（監査ログ）</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>シフト手動変更や申請の提出・承認・却下・削除の履歴を確認</ThemeText>
                </View>
                <TouchableOpacity 
                  style={[styles.inlineBtn, { backgroundColor: 'rgba(168, 85, 247, 0.1)' }]} 
                  onPress={() => setShowAuditLogModal(true)}
                  activeOpacity={0.7}
                >
                  <ThemeText bold color="#a855f7" style={{ marginRight: 4 }}>履歴表示</ThemeText>
                  <ChevronRight size={16} color="#a855f7" />
                </TouchableOpacity>
              </ThemeCard>

              <ThemeCard style={styles.itemRow}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.1)' }]}>
                  <RefreshCw size={20} color="#38bdf8" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>アプリ強制更新（キャッシュクリア）</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>PWA・ブラウザのキャッシュとServiceWorkerを破棄し、最新版を強制再読み込みします</ThemeText>
                </View>
                <TouchableOpacity 
                  style={[styles.inlineBtn, { backgroundColor: 'rgba(56, 189, 248, 0.1)' }, isUpdatingApp && { opacity: 0.5 }]} 
                  onPress={async () => {
                    if (isUpdatingApp) return;
                    setIsUpdatingApp(true);
                    await forceAppUpdate();
                  }}
                  disabled={isUpdatingApp}
                >
                  {isUpdatingApp ? (
                    <ActivityIndicator size="small" color="#38bdf8" />
                  ) : (
                    <>
                      <RefreshCw size={18} color="#38bdf8" />
                      <ThemeText bold color="#38bdf8" style={{ marginLeft: 6 }}>実行</ThemeText>
                    </>
                  )}
                </TouchableOpacity>
              </ThemeCard>

              {/* 📊 管理者専用: 全職員の年休取得率一覧（インライン表示） */}
              <View style={{ marginTop: 24 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <BarChart2 size={20} color="#34d399" />
                    <ThemeText bold variant="h2">📊 年休取得率 集計一覧 ({(currentDate || new Date()).getFullYear()}年)</ThemeText>
                  </View>
                  <TouchableOpacity 
                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(52, 211, 153, 0.15)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                    onPress={() => setShowLeaveStatsModal(true)}
                  >
                    <ThemeText variant="caption" bold color="#34d399">全体集計表・印刷</ThemeText>
                    <ChevronRight size={14} color="#34d399" style={{ marginLeft: 2 }} />
                  </TouchableOpacity>
                </View>
                
                <View style={{ gap: 8 }}>
                  {staffLeaveStatsList.map(item => {
                    const barWidth = Math.min(100, Math.max(0, item.ratePercent));
                    return (
                      <ThemeCard key={`card_${item.staff.id || item.staff.email || item.staff.name}`} style={styles.leaveStaffCard}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <View style={{ flex: 1, paddingRight: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <ThemeText bold style={{ fontSize: 15 }}>{item.staff.name}</ThemeText>
                              <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                <ThemeText variant="caption" color={COLORS.textSecondary} style={{ fontSize: 10 }}>{item.staff.jobType || item.staff.profession || '-'}</ThemeText>
                              </View>
                              {item.staff.placement ? (
                                <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                  <ThemeText variant="caption" color={COLORS.textSecondary} style={{ fontSize: 10 }}>{item.staff.placement}</ThemeText>
                                </View>
                              ) : null}
                            </View>
                            <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginTop: 4, fontSize: 11 }}>
                              {item.displayText}
                            </ThemeText>
                          </View>
                          
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <View style={[styles.rateBadge, { backgroundColor: `${item.statusColor}20`, borderColor: item.statusColor }]}>
                              <ThemeText bold color={item.statusColor} style={{ fontSize: 12 }}>
                                {item.rateStr}
                              </ThemeText>
                            </View>
                            <ThemeText bold color={item.mStatus.isCompleted ? '#10b981' : '#f59e0b'} style={{ fontSize: 10 }}>
                              {item.mStatus.isCompleted ? '5日達成済' : item.mStatus.displayText}
                            </ThemeText>
                          </View>
                        </View>

                        {/* プログレスバー */}
                        <View style={styles.leaveProgressBarTrack}>
                          <View style={[styles.leaveProgressBarFill, { width: `${barWidth}%`, backgroundColor: item.statusColor }]} />
                        </View>
                      </ThemeCard>
                    );
                  })}
                </View>
              </View>

              <View style={{ marginTop: 24, paddingBottom: 40 }}>
                <ThemeText bold variant="h2" style={{ marginBottom: 16 }}>📈 {currentMonth + 1}月の必要人数設定</ThemeText>
                <View style={styles.limitGrid}>
                  {/* [V60.4] 平日の上限設定を廃止 */}
                  <View style={{ flex: 1 }} />
                  <DropdownSelector label="土曜" value={limits.sat} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('sat', v, currentMonthStr)} style={{flex:1}} />
                </View>
                <View style={styles.limitGrid}>
                  <DropdownSelector label="日曜" value={limits.sun} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('sun', v, currentMonthStr)} style={{flex:1}} />
                  <DropdownSelector label="祝日" value={limits.pub} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('pub', v, currentMonthStr)} style={{flex:1}} />
                </View>
              </View>
            </View>
          ) : null}
          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}><LogOut size={20} color="#ef4444" /><ThemeText bold color="#ef4444" style={{ marginLeft: 10 }}>アプリからログアウト</ThemeText></TouchableOpacity>
        </View>
      </ScrollView>

      {/* 年休取得率 集計表モーダル */}
      <Modal visible={showLeaveStatsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.statsModalBox}>
            <View style={styles.pickerHeader}>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <BarChart2 size={22} color="#34d399" />
                  <ThemeText variant="h2">職員 年休取得率 集計表</ThemeText>
                </View>
                <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginTop: 2 }}>
                  {(currentDate || new Date()).getFullYear()}年度（管理者専用・全職員一覧）
                </ThemeText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {Platform.OS === 'web' && (
                  <TouchableOpacity onPress={handlePrintLeaveStatsReport} style={styles.iconBtn}>
                    <Printer size={20} color="#34d399" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setShowLeaveStatsModal(false)}>
                  <X size={24} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* ソートボタン */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              <TouchableOpacity 
                style={[styles.filterChip, leaveStatsSort === 'rate_asc' && styles.filterChipActive]}
                onPress={() => setLeaveStatsSort('rate_asc')}
              >
                <ThemeText variant="caption" bold={leaveStatsSort === 'rate_asc'} color={leaveStatsSort === 'rate_asc' ? '#34d399' : COLORS.textSecondary}>取得率が低い順</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.filterChip, leaveStatsSort === 'rate_desc' && styles.filterChipActive]}
                onPress={() => setLeaveStatsSort('rate_desc')}
              >
                <ThemeText variant="caption" bold={leaveStatsSort === 'rate_desc'} color={leaveStatsSort === 'rate_desc' ? '#34d399' : COLORS.textSecondary}>取得率が高い順</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.filterChip, leaveStatsSort === 'name' && styles.filterChipActive]}
                onPress={() => setLeaveStatsSort('name')}
              >
                <ThemeText variant="caption" bold={leaveStatsSort === 'name'} color={leaveStatsSort === 'name' ? '#34d399' : COLORS.textSecondary}>氏名順</ThemeText>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={{ gap: 8 }}>
                {[...staffLeaveStatsList].sort((a, b) => {
                  if (leaveStatsSort === 'rate_asc') return a.ratePercent - b.ratePercent;
                  if (leaveStatsSort === 'rate_desc') return b.ratePercent - a.ratePercent;
                  return (a.staff.name || '').localeCompare(b.staff.name || '');
                }).map(item => {
                  const barWidth = Math.min(100, Math.max(0, item.ratePercent));
                  return (
                    <View key={`modal_${item.staff.id || item.staff.email || item.staff.name}`} style={styles.modalStaffRow}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <ThemeText bold style={{ fontSize: 15 }}>{item.staff.name}</ThemeText>
                          <ThemeText variant="caption" color={COLORS.textSecondary}>{item.staff.jobType || item.staff.profession || ''} / {item.staff.placement || ''}</ThemeText>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={[styles.rateBadge, { backgroundColor: `${item.statusColor}20`, borderColor: item.statusColor }]}>
                            <ThemeText bold color={item.statusColor} style={{ fontSize: 11 }}>{item.rateStr}</ThemeText>
                          </View>
                        </View>
                      </View>
                      
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <ThemeText variant="caption" color={COLORS.textSecondary} style={{ fontSize: 11 }}>
                          付与: <ThemeText bold color="white">{item.grantDays}日</ThemeText> | 取得: <ThemeText bold color="#38bdf8">{item.usedDays}日</ThemeText> | 残: <ThemeText bold color="#a855f7">{item.formattedRemStr}</ThemeText>
                        </ThemeText>
                        <ThemeText variant="caption" bold color={item.mStatus.isCompleted ? '#10b981' : '#f59e0b'} style={{ fontSize: 11 }}>
                          {item.mStatus.isCompleted ? '5日達成済' : item.mStatus.displayText}
                        </ThemeText>
                      </View>

                      <View style={styles.leaveProgressBarTrack}>
                        <View style={[styles.leaveProgressBarFill, { width: `${barWidth}%`, backgroundColor: item.statusColor }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 操作履歴（監査ログ）モーダル */}
      <AuditLogModal
        visible={showAuditLogModal}
        onClose={() => setShowAuditLogModal(false)}
      />

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: COLORS.background, 
    width: '100%',
    maxWidth: '100%',
    alignItems: 'stretch',
    alignSelf: 'stretch'
  },
  header: { 
    padding: SPACING.md, 
    paddingTop: 10, 
    width: '100%',
    alignItems: 'stretch',
    alignSelf: 'stretch'
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 16, width: '100%' },
  approvalItem: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, borderLeftWidth: 3, borderLeftColor: '#ef4444', width: '100%' },
  miniApproveBtn: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  inlineBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },

  staffAdminList: { marginBottom: 20, width: '100%' },
  staffAdminItem: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.015)', borderRadius: 12, width: '100%' },
  staffMiniEdit: { flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: 8 },
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 20, width: '100%' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 60, borderRadius: 16, marginTop: 20, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', width: '100%' },
  dropdownBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, height: 52, paddingHorizontal: 16, width: '100%' },
  limitGrid: { flexDirection: 'row', gap: 12, width: '100%' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', width: '100%' },
  detailModal: { width: '90%', backgroundColor: '#0f172a', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, height: 52, paddingHorizontal: 16, color: 'white', fontSize: 16, marginBottom: 8, width: '100%' },
  cancelBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  confirmBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: '#38bdf8', justifyContent: 'center', alignItems: 'center' },
  pickerContainer: { width: '90%', maxHeight: '70%', backgroundColor: '#0f172a', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', width: '100%' },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.02)', width: '100%' },
  pickerItemActive: { backgroundColor: 'rgba(56, 189, 248, 0.05)' },

  // 年休取得率用スタイル
  leaveStaffCard: { padding: 14, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', width: '100%' },
  leaveProgressBarTrack: { width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  leaveProgressBarFill: { height: '100%', borderRadius: 3 },
  rateBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  statsModalBox: { width: '92%', maxHeight: '85%', backgroundColor: '#0f172a', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  filterChipActive: { backgroundColor: 'rgba(52, 211, 153, 0.15)', borderColor: '#34d399' },
  modalStaffRow: { padding: 12, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' }
});
