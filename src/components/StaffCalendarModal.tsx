import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Alert, TextInput, Platform } from 'react-native';
import { ThemeText } from './ThemeText';
import { COLORS } from '../theme/theme';
import { ChevronLeft, ChevronRight, X, Printer } from 'lucide-react-native';
import { getMonthInfo, getDayType, getDateStr, normalizeDateStr } from '../utils/dateUtils';
import { cloudStorage } from '../utils/cloudStorage';
import { supabase } from '../utils/supabase';
import { recordAuditLog } from '../utils/auditLogger';
import { isAccountingYearStaff } from '../utils/leaveUtils';
import { HourStepper } from './HourStepper';

export interface MonthDay {
  day: number;
  dateStr: string;
  isH?: boolean;
  empty: boolean;
}

const SHIFT_TYPES = ['出勤', 'カスタム', '公休', '夏季休暇', '時間休', '振替＋時間休', '振替4', '特休', '年休', '特休＋時間休', '出張', '空欄'];
const HOUR_SELECTOR_TYPES = ['時間休', '特休', '特休＋時間休', '振替＋時間休', '出張'];

export const normalizeStaffKey = (n: string) => (n || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/公費/g, '').toUpperCase();

export const getReqHours = (r: any): number => {
  if (!r) return 0;
  const h = r.hours;
  const parsedH = parseFloat(String(h));
  const rType = (r.type || '').trim();
  const isFullDayLeaveType = ['年休', '有給休暇', '夏季休暇', '特休', '全休', '休暇', '欠勤', '年給', '有給', '出張'].includes(rType);

  if (rType === '出張') {
    const dur = r.details?.duration ?? r.details?.hours;
    const parsedDur = parseFloat(String(dur));
    if (h !== undefined && h !== null && h !== '' && !isNaN(parsedH) && parsedH > 0) return parsedH;
    if (dur !== undefined && dur !== null && !isNaN(parsedDur) && parsedDur > 0) return parsedDur;
    return 7.75;
  }

  if (h !== undefined && h !== null && h !== '' && !isNaN(parsedH)) {
    if (parsedH === 0 && isFullDayLeaveType) return 7.75;
    return parsedH;
  }

  if (r.type === '振替4') return 4.0;
  if (isFullDayLeaveType) return 7.75;
  if (rType === '午前休') return 4.0;
  if (rType === '午後休') return 3.75;

  return 0;
};

// --- [CALENDAR GRID COMPONENT (MEMOIZED)] ---
interface CalendarGridProps {
  monthInfo: MonthDay[];
  requestMap: Map<string, Map<string, any>>;
  selectedStaff: any;
  selectedDay: string | null;
  onDayPress: (d: MonthDay) => void;
}

const CalendarGrid: React.FC<CalendarGridProps> = React.memo(({
  monthInfo,
  requestMap,
  selectedStaff,
  selectedDay,
  onDayPress,
}) => {
  const days = ['日', '月', '火', '水', '木', '金', '土'];

  const rows: MonthDay[][] = useMemo(() => {
    const res: MonthDay[][] = [];
    let currentRow: MonthDay[] = [];
    monthInfo.forEach((d, i) => {
      currentRow.push(d);
      if (currentRow.length === 7 || i === monthInfo.length - 1) {
        while (currentRow.length < 7) {
          currentRow.push({ day: 0, dateStr: `empty-${i}-${currentRow.length}`, empty: true, isH: false });
        }
        res.push(currentRow);
        currentRow = [];
      }
    });
    return res;
  }, [monthInfo]);

  const sId = String(selectedStaff?.id || '').trim();
  const sName = normalizeStaffKey(selectedStaff?.name || '');
  const emailPrefix = selectedStaff?.email ? selectedStaff.email.split('@')[0].toUpperCase() : null;
  const isFiscal = isAccountingYearStaff(selectedStaff);
  const defaultWorkH = isFiscal ? 7.5 : 7.75;

  return (
    <View style={styles.calendarContainer}>
      <View style={styles.calendarRow}>
        {days.map(d => (
          <View key={d} style={styles.calendarHeaderCell}>
            <ThemeText variant="caption" color={COLORS.textSecondary} style={{ fontSize: 12 }}>{d}</ThemeText>
          </View>
        ))}
      </View>

      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.calendarRow}>
          {row.map((d, colIndex) => {
            if (!d || d.empty) {
              return <View key={`empty-${rowIndex}-${colIndex}`} style={styles.calendarDayCell} />;
            }

            const isSelected = selectedDay === d.dateStr;
            const dayMap = requestMap.get(d.dateStr);
            const rId = sId ? dayMap?.get(sId) : null;
            const rName = sName ? dayMap?.get(sName) : null;
            const rEmail = emailPrefix ? dayMap?.get(emailPrefix) : null;
            const potentialReqs = [rId, rName, rEmail].filter(Boolean);
            const req = potentialReqs.find(r => !['出勤', '日勤', '特別出勤', 'カスタム'].includes(r.type)) || potentialReqs[0];

            let displayLabel = '';
            let labelColor = 'white';

            if (req) {
              const h = getReqHours(req);
              const rType = (req.type || '').trim();
              const customName = req.customType || req.details?.customType;

              if (['出勤', '日勤'].includes(rType)) {
                displayLabel = '出勤';
                labelColor = '#38bdf8';
              } else if (rType === '出張') {
                const tripName = req.customTitle || req.customType || req.details?.customTitle || req.details?.customType || (req.details?.note && !['出張', '手動割当', '管理画面よりクイック変更', '管理画面より更新'].includes(req.details?.note) ? req.details?.note : '');
                const displayH = (h && h > 0) ? h : (req.details?.duration ?? req.details?.hours ?? defaultWorkH);
                if (tripName) {
                  const shortTrip = tripName.length > 3 ? tripName.slice(0, 3) : tripName;
                  displayLabel = `${shortTrip}(${displayH}h)`;
                } else {
                  displayLabel = `出張(${displayH}h)`;
                }
                labelColor = '#f97316';
              } else if (rType === 'カスタム' || (rType !== '出張' && customName)) {
                const cName = customName || 'カスタム';
                displayLabel = cName.length > 3 ? cName.slice(0, 3) : cName;
                labelColor = '#38bdf8';
              } else if (rType === '特別出勤') {
                displayLabel = '特出';
                labelColor = '#38bdf8';
              } else if (rType === '公休') {
                displayLabel = '公休';
                labelColor = '#ef4444';
              } else if (rType === '夏季休暇') {
                displayLabel = '夏季';
                labelColor = '#ef4444';
              } else if (['年休', '有給休暇', '年給', '有給'].includes(rType)) {
                displayLabel = '年休';
                labelColor = '#ef4444';
              } else if (rType === '振替4' || rType === '振4') {
                displayLabel = '振4';
                labelColor = '#ef4444';
              } else if (rType === '特休＋時間休') {
                const sp = req.details?.specialHours ?? 0;
                const hr = req.details?.hourlyHours ?? 0;
                displayLabel = `特${sp}+${hr}`;
                labelColor = '#ef4444';
              } else if (rType === '振替＋時間休') {
                const hr = req.details?.hourlyHours ?? (req.hours ? Math.max(0, req.hours - 4) : 0);
                displayLabel = hr > 0 ? `振+時${hr}` : '振＋時';
                labelColor = '#ef4444';
              } else if (['時間休', '時間給', '特休', '午前休', '午後休'].includes(rType)) {
                displayLabel = `${rType.charAt(0)}(${h}h)`;
                labelColor = '#ef4444';
              } else {
                displayLabel = rType.slice(0, 2);
                if (['公休', '欠勤', '休暇', '全休'].includes(rType)) labelColor = '#ef4444';
              }
            } else {
              const dDate = new Date(d.dateStr);
              const dtype = getDayType(dDate);
              if (dtype === 'weekday') {
                displayLabel = '出勤';
                labelColor = '#38bdf8';
              } else {
                displayLabel = '公休';
                labelColor = '#ef4444';
              }
            }

            return (
              <TouchableOpacity
                key={d.dateStr}
                style={[styles.calendarDayCell, isSelected && styles.calendarDaySelected]}
                onPress={() => onDayPress(d)}
                activeOpacity={0.6}
              >
                <ThemeText bold={isSelected} color={d.isH ? '#ef4444' : 'white'} style={{ fontSize: 13, marginBottom: 2 }}>
                  {d.day}
                </ThemeText>
                <View style={styles.statusLabelContainer}>
                  {displayLabel ? (
                    <ThemeText
                      numberOfLines={1}
                      style={[styles.statusLabel, { color: labelColor }]}
                      adjustsFontSizeToFit={true}
                      minimumFontScale={0.5}
                    >
                      {displayLabel}
                    </ThemeText>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
});

// --- [MAIN CALENDAR MODAL COMPONENT] ---
export interface StaffCalendarModalProps {
  visible: boolean;
  onClose: () => void;
  selectedStaff: any;
  activeDate: Date;
  setActiveDate: (d: Date | ((prev: Date) => Date)) => void;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  shifts?: any[];
  fetchShifts?: () => Promise<void>;
  isPrivileged?: boolean;
  isAdminAuthenticated?: boolean;
  profile: any;
  onDeleteRequest?: (id: string) => void;
  requestMap: Map<string, Map<string, any>>;
  leaveStats: { workDays: number; holidayWorkDays: number; leaveHours: string };
}

export const StaffCalendarModal: React.FC<StaffCalendarModalProps> = React.memo(({
  visible,
  onClose,
  selectedStaff,
  activeDate,
  setActiveDate,
  requests,
  setRequests,
  shifts,
  fetchShifts,
  isPrivileged,
  isAdminAuthenticated,
  profile,
  onDeleteRequest,
  requestMap,
  leaveStats,
}) => {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState('出勤');
  const [staffCustomTitle, setStaffCustomTitle] = useState('');
  const [staffTripTitle, setStaffTripTitle] = useState('');
  const [selectedHours, setSelectedHours] = useState(1.0);
  const [specialHours, setSpecialHours] = useState(1.0);
  const [hourlyHours, setHourlyHours] = useState(1.0);
  const [isSaving, setIsSaving] = useState(false);

  // 上限所定労働時間の計算 (会計年度または助手: 7.5h, その他通常職員: 7.75h)
  const isFiscal = isAccountingYearStaff(selectedStaff);
  const maxWorkingHours = isFiscal ? 7.5 : 7.75;
  // 振替+時間休における時間休の上限: 所定労働時間 - 振替4h (7.75h -> 3.75h, 7.5h -> 3.5h)
  const maxFurikaeHourly = Math.max(0.25, Math.round((maxWorkingHours - 4.0) * 100) / 100);

  const monthInfo = useMemo(() => {
    return (getMonthInfo(activeDate.getFullYear(), activeDate.getMonth()) || []) as MonthDay[];
  }, [activeDate]);

  // モーダルが閉じられた際やスタッフ変更時に選択日をリセット
  useEffect(() => {
    if (!visible) {
      setSelectedDay(null);
    }
  }, [visible, selectedStaff?.id]);

  const handleDayPress = useCallback((d: MonthDay) => {
    if (!d || d.empty) return;
    setSelectedDay(d.dateStr);

    const sId = String(selectedStaff?.id || '').trim();
    const sName = normalizeStaffKey(selectedStaff?.name || '');
    const emailPrefix = selectedStaff?.email ? selectedStaff.email.split('@')[0].toUpperCase() : null;
    const dayMap = requestMap.get(d.dateStr);

    const rId = sId ? dayMap?.get(sId) : null;
    const rName = sName ? dayMap?.get(sName) : null;
    const rEmail = emailPrefix ? dayMap?.get(emailPrefix) : null;
    const potentialReqs = [rId, rName, rEmail].filter(Boolean);
    const existing = potentialReqs.find(r => !['出勤', '日勤'].includes(r.type)) || potentialReqs[0];

    const defaultH = maxWorkingHours;

    if (existing) {
      const isTrip = existing.type === '出張';
      const existingCustom = !isTrip ? (existing.customType || existing.details?.customType || (existing.type === '特別出勤' ? '特別出勤' : '')) : '';
      const existingTrip = isTrip ? (existing.customTitle || existing.customType || existing.details?.customTitle || existing.details?.customType || (existing.details?.note && !['出張', '手動割当', '管理画面よりクイック変更', '管理画面より更新'].includes(existing.details?.note) ? existing.details?.note : '')) : '';

      setStaffCustomTitle(existingCustom);
      setStaffTripTitle(existingTrip);
      setSelectedType(existing.type === '特別出勤' ? 'カスタム' : ((existing.type === '日勤' || existing.type === '出勤') ? '出勤' : existing.type));
      setSelectedHours(getReqHours(existing) || (isTrip ? defaultH : 1.0));
      setSpecialHours(existing.details?.specialHours || 1.0);
      setHourlyHours(existing.details?.hourlyHours || (existing.type === '振替＋時間休' && existing.hours ? Math.max(0.25, existing.hours - 4.0) : 1.0));
    } else {
      setStaffCustomTitle('');
      setStaffTripTitle('');
      setSelectedType('出勤');
      setSelectedHours(1.0);
      setSpecialHours(1.0);
      setHourlyHours(1.0);
    }
  }, [selectedStaff, requestMap, maxWorkingHours]);

  const handleDeleteCurrentDay = useCallback(async (showConfirm = true) => {
    if (!selectedDay || !selectedStaff || isSaving) return;
    const sT = normalizeStaffKey(selectedStaff.name);
    const emailPrefix = selectedStaff.email ? selectedStaff.email.split('@')[0].toUpperCase() : null;
    const existing = requests.filter((r: any) => r && (
      (String(r.staffId) === selectedStaff.id || normalizeStaffKey(r.staffName || r.staff_name) === sT || (emailPrefix && normalizeStaffKey(r.staffName || r.staff_name) === emailPrefix))
      && r.date === selectedDay
    ) && r.status !== 'deleted');

    if (existing.length === 0) {
      if (showConfirm) Alert.alert('情報', '削除する予定がありません。');
      return;
    }

    const performDelete = async () => {
      setIsSaving(true);
      try {
        for (const r of existing) {
          if (r.id) {
            if (onDeleteRequest) {
              await onDeleteRequest(r.id);
            } else {
              setRequests((prev: any[]) => prev.filter((req: any) => req.id !== r.id));
              await cloudStorage.upsertRequests([{ ...r, status: 'deleted', updatedAt: new Date().toISOString() }]);
            }
          }
        }

        if (selectedStaff?.id) {
          const cleanStaffId = String(selectedStaff.id).trim();
          await supabase.from('shifts').delete()
            .eq('staff_id', cleanStaffId)
            .eq('date', selectedDay);
        }

        await recordAuditLog({
          operatorId: profile?.id,
          operatorName: profile?.name || '管理者',
          targetStaffId: selectedStaff.id,
          targetStaffName: selectedStaff.name,
          actionType: 'SHIFT_UPDATE',
          targetDate: selectedDay,
          details: `${selectedStaff.name}さんの予定（${selectedDay}）を削除しました`,
          beforeData: existing
        });

        if (fetchShifts) await fetchShifts();

        setSelectedType('出勤');
        setSelectedHours(1.0);
        if (showConfirm) Alert.alert('完了', '予定を削除しました。');
      } catch (e) {
        Alert.alert('エラー', '削除に失敗しました。');
      } finally {
        setIsSaving(false);
      }
    };

    if (showConfirm) {
      Alert.alert('予定の削除', `${selectedDay} の予定を完全に削除しますか？`, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除する', style: 'destructive', onPress: performDelete }
      ]);
    } else {
      await performDelete();
    }
  }, [selectedDay, selectedStaff, isSaving, requests, onDeleteRequest, setRequests, profile, fetchShifts]);

  const handleConfirmShift = useCallback(async () => {
    if (!selectedDay || !selectedStaff || isSaving) return;

    if (selectedType === '空欄') {
      await handleDeleteCurrentDay(false);
      return;
    }

    setIsSaving(true);
    try {
      const type = selectedType;
      const now = new Date().toISOString();
      const isCustom = type === 'カスタム';
      const customName = staffCustomTitle.trim() || 'カスタム';
      const isTrip = type === '出張';
      const tripTitle = staffTripTitle.trim();
      const tripHours = (selectedHours && selectedHours > 0) ? selectedHours : maxWorkingHours;

      const newReq = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        staffId: selectedStaff.id,
        staff_id: selectedStaff.id,
        staffName: selectedStaff.name,
        date: selectedDay,
        type: type,
        customType: isCustom ? customName : (isTrip ? (tripTitle || undefined) : undefined),
        customTitle: isTrip ? (tripTitle || undefined) : undefined,
        hours: isCustom
          ? 0
          : isTrip
            ? tripHours
            : type === '特休＋時間休'
              ? (specialHours + hourlyHours)
              : type === '振替＋時間休'
                ? (4.0 + hourlyHours)
                : type === '振替4'
                  ? 4.0
                  : (HOUR_SELECTOR_TYPES.includes(type) ? selectedHours : null),
        details: isCustom
          ? { note: customName, customType: customName, isCustomWork: true, isManual: true }
          : isTrip
            ? { note: tripTitle || '出張', customTitle: tripTitle, customType: tripTitle, duration: tripHours, hours: tripHours, isManual: true }
            : type === '特休＋時間休'
              ? { note: '管理画面より更新', specialHours, hourlyHours, isManual: true }
              : type === '振替＋時間休'
                ? { note: '管理画面より更新', furikaeHours: 4.0, hourlyHours, isManual: true }
                : type === '振替4'
                  ? { note: '振替4時間', furikaeHours: 4.0, isManual: true }
                  : { note: '管理画面より更新', isManual: true },
        status: 'approved',
        createdAt: now,
        updatedAt: now,
        isShift: true,
        isManual: true,
        is_manual: true
      };

      const sT = normalizeStaffKey(selectedStaff.name);
      const emailPrefix = selectedStaff.email ? selectedStaff.email.split('@')[0].toUpperCase() : null;
      setRequests((prev: any[]) => {
        const without = prev.filter((r: any) => r && !(
          (String(r.staffId) === selectedStaff.id || normalizeStaffKey(r.staffName || r.staff_name) === sT || (emailPrefix && normalizeStaffKey(r.staffName || r.staff_name) === emailPrefix))
          && r.date === selectedDay
        ));
        return [newReq, ...without];
      });

      await cloudStorage.upsertRequestsAndShifts([newReq]);

      await recordAuditLog({
        operatorId: profile?.id,
        operatorName: profile?.name || '管理者',
        targetStaffId: selectedStaff.id,
        targetStaffName: selectedStaff.name,
        actionType: 'SHIFT_UPDATE',
        targetDate: selectedDay,
        details: isCustom
          ? `${selectedStaff.name}さんの予定（${selectedDay}）を「${customName}（カスタム出勤）」に設定しました`
          : isTrip
            ? `${selectedStaff.name}さんの予定（${selectedDay}）を「${tripTitle || '出張'}」に設定しました${newReq.hours ? ` (${newReq.hours}h)` : ''}`
            : `${selectedStaff.name}さんの予定（${selectedDay}）を「${type}」に設定しました${newReq.hours ? ` (${newReq.hours}h)` : ''}`,
        afterData: newReq
      });

      setStaffTripTitle('');

      if (fetchShifts) {
        await fetchShifts();
      }
      Alert.alert('完了', '保存しました');
    } catch (e) {
      console.error('Confirm Shift Error:', e);
      Alert.alert('エラー', '保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  }, [selectedDay, selectedStaff, isSaving, selectedType, staffCustomTitle, staffTripTitle, maxWorkingHours, selectedHours, specialHours, hourlyHours, setRequests, profile, fetchShifts, handleDeleteCurrentDay]);

  const handlePrint = useCallback(() => {
    if (Platform.OS !== 'web' || !selectedStaff) return;

    try {
      const year = activeDate.getFullYear();
      const month = activeDate.getMonth() + 1;
      const sId = String(selectedStaff.id || '').trim();
      const sName = normalizeStaffKey(selectedStaff.name);
      const emailPrefix = selectedStaff.email ? selectedStaff.email.split('@')[0].toUpperCase() : null;
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;

      let rowsHtml = '';
      monthInfo.forEach((d: MonthDay) => {
        if (d.empty) return;
        const dateKey = normalizeDateStr(d.dateStr);
        const dayMap = requestMap.get(dateKey);

        const rId = sId ? dayMap?.get(sId) : null;
        const rName = sName ? dayMap?.get(sName) : null;
        const rEmail = emailPrefix ? dayMap?.get(emailPrefix) : null;
        const potentialReqs = [rId, rName, rEmail].filter(Boolean);
        const r = potentialReqs[0] || null;

        let type = '';
        const dDate = new Date(d.dateStr.replace(/-/g, '/'));
        const dtype = getDayType(dDate);
        const isNoHoliday = (dtype !== 'weekday') && (selectedStaff.monthlyNoHoliday?.[currentMonthKey] ?? selectedStaff.noHoliday);

        if (r && r.type) {
          type = String(r.type).trim();
        } else {
          type = (dtype === 'weekday' || isNoHoliday) ? '出勤' : '公休';
        }

        const h = r ? getReqHours(r) : 0;
        let shiftDisplay = type;
        if (type === '出勤' || type === '日勤') {
          shiftDisplay = '出勤';
        } else if (type === '特休＋時間休') {
          const spHrs = r?.details?.specialHours ?? 0;
          const hrHrs = r?.details?.hourlyHours ?? 0;
          shiftDisplay = `特休${spHrs}h＋時間休${hrHrs}h`;
        } else if (type === '振替＋時間休') {
          const hrHrs = r?.details?.hourlyHours ?? (r?.hours ? Math.max(0, r.hours - 4) : 0);
          shiftDisplay = `振替4h＋時間休${hrHrs}h`;
        } else if (HOUR_SELECTOR_TYPES.includes(type) && h > 0) {
          shiftDisplay = `${type}(${h}h)`;
        }

        const dayIdx = isNaN(dDate.getTime()) ? 0 : dDate.getDay();
        const style = (d.isH || dayIdx === 0) ? 'color: #ef4444; background-color: #fef2f2;' : (dayIdx === 6 ? 'color: #3b82f6; background-color: #eff6ff;' : '');

        rowsHtml += `
          <tr style="${style}">
            <td style="text-align: center;">${d.day}</td>
            <td style="text-align: center;">${dayNames[dayIdx]}</td>
            <td style="font-weight: bold; text-align: center;">${shiftDisplay}</td>
            <td>${r?.details?.note || ''}</td>
          </tr>
        `;
      });

      const html = `<html><head><title>個人別勤務実績表</title><style>@page { size: A4 portrait; margin: 10mm; } body { font-family: sans-serif; padding: 20px; color: #1e293b; } .header { border-bottom: 2px solid #38bdf8; padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; } h1 { margin: 0; font-size: 20px; } .meta { font-size: 14px; text-align: right; } table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: center; } th { background-color: #f8fafc; font-size: 13px; font-weight: bold; }</style></head><body><div class="header"><div><h1>個人別勤務実績表 (${month}月)</h1><div style="margin-top: 5px;">氏名: <strong style="font-size: 18px;">${selectedStaff.name}</strong></div></div><div class="meta">${year}年${month}月分<br/>職種: ${selectedStaff.jobType || selectedStaff.profession || ''}</div></div><table><thead><tr><th style="width: 50px;">日</th><th style="width: 50px;">曜</th><th>勤務実績 / 申請</th><th>特記事項</th></tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print();};<\\/script></body></html>`;

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        Alert.alert('ポップアップ制限', '実績表のプレビューが開けませんでした。ブラウザ設定でポップアップを許可してください。');
      }
    } catch (e) {
      console.error('Print Error:', e);
      Alert.alert('エラー', 'データの生成中に問題が発生しました。');
    }
  }, [activeDate, selectedStaff, monthInfo, requestMap]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.calendarModal}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <ThemeText variant="h2">{selectedStaff?.name || ''}</ThemeText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ThemeText variant="caption" color={COLORS.textSecondary}>
                  {activeDate.getFullYear()}年 {activeDate.getMonth() + 1}月
                </ThemeText>
                {selectedStaff && (
                  <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                    <ThemeText variant="caption" color="#38bdf8" bold>
                      休暇合計: {leaveStats.leaveHours}h
                    </ThemeText>
                  </View>
                )}
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              {Platform.OS === 'web' && (
                <TouchableOpacity onPress={handlePrint} style={styles.iconBtn} activeOpacity={0.6}>
                  <Printer size={22} color="#38bdf8" />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} activeOpacity={0.6}>
                <X size={24} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Body */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
            {/* Month Nav */}
            <View style={styles.calendarNav}>
              <TouchableOpacity
                onPress={() => {
                  setActiveDate(new Date(activeDate.getFullYear(), activeDate.getMonth() - 1, 1));
                  setSelectedDay(null);
                }}
                activeOpacity={0.6}
              >
                <ChevronLeft color="white" />
              </TouchableOpacity>
              <ThemeText bold>{activeDate.getMonth() + 1}月</ThemeText>
              <TouchableOpacity
                onPress={() => {
                  setActiveDate(new Date(activeDate.getFullYear(), activeDate.getMonth() + 1, 1));
                  setSelectedDay(null);
                }}
                activeOpacity={0.6}
              >
                <ChevronRight color="white" />
              </TouchableOpacity>
            </View>

            {/* Memoized Calendar Grid */}
            <CalendarGrid
              monthInfo={monthInfo}
              requestMap={requestMap}
              selectedStaff={selectedStaff}
              selectedDay={selectedDay}
              onDayPress={handleDayPress}
            />

            {/* Shift Editor Section */}
            {selectedDay ? (
              <View style={styles.editorSection}>
                <ThemeText bold style={{ marginBottom: 12 }}>{selectedDay} の確定</ThemeText>
                <View style={styles.typeGrid}>
                  {SHIFT_TYPES.map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.typeBtn, selectedType === type && styles.typeBtnActive]}
                      onPress={() => {
                        setSelectedType(type);
                        if (type === '出張' && (!selectedHours || selectedHours <= 1.0)) {
                          setSelectedHours(maxWorkingHours);
                        }
                      }}
                      activeOpacity={0.6}
                    >
                      <ThemeText bold={selectedType === type} color={selectedType === type ? 'white' : COLORS.textSecondary}>
                        {type}
                      </ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                {selectedType === 'カスタム' && (
                  <View style={{ marginTop: 12 }}>
                    <ThemeText variant="label" style={{ marginBottom: 6 }}>項目名 (出勤扱い・時間計算なし)</ThemeText>
                    <TextInput
                      style={styles.input}
                      placeholder="項目名を入力 (例: 外部研修)"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      value={staffCustomTitle}
                      onChangeText={setStaffCustomTitle}
                    />
                  </View>
                )}

                {selectedType === '出張' && (
                  <View style={{ marginTop: 12 }}>
                    <ThemeText variant="label" style={{ marginBottom: 6 }}>出張・研修名 (任意・未入力時は「出張」)</ThemeText>
                    <TextInput
                      style={styles.input}
                      placeholder="出張・研修名を入力 (例: 〇〇学会)"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      value={staffTripTitle}
                      onChangeText={setStaffTripTitle}
                    />
                  </View>
                )}

                {HOUR_SELECTOR_TYPES.includes(selectedType) && (
                  <View style={{ marginTop: 12 }}>
                    <ThemeText variant="label" style={{ marginBottom: 12 }}>
                      時間設定 (0.25h単位 / 上限: {maxWorkingHours}h)
                    </ThemeText>

                    {selectedType === '特休＋時間休' ? (
                      <View style={{ gap: 16 }}>
                        <View>
                          <ThemeText variant="caption" style={{ marginBottom: 6 }}>特休の時間数</ThemeText>
                          <HourStepper
                            value={specialHours}
                            onChange={setSpecialHours}
                            min={0.25}
                            max={maxWorkingHours}
                            step={0.25}
                          />
                        </View>
                        <View>
                          <ThemeText variant="caption" style={{ marginBottom: 6 }}>時間休の時間数</ThemeText>
                          <HourStepper
                            value={hourlyHours}
                            onChange={setHourlyHours}
                            min={0.25}
                            max={maxWorkingHours}
                            step={0.25}
                          />
                        </View>
                        <ThemeText variant="caption" bold style={{ marginTop: 4 }}>
                          合計時間: {(specialHours + hourlyHours).toFixed(2)}h
                        </ThemeText>
                      </View>
                    ) : selectedType === '振替＋時間休' ? (
                      <View style={{ gap: 12 }}>
                        <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.12)', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                          <ThemeText variant="caption" color={COLORS.primary} bold>
                            ※ 振替4時間 ＋ 時間休 {hourlyHours.toFixed(2)}時間（合計: {(4.0 + hourlyHours).toFixed(2)}h）
                          </ThemeText>
                          <ThemeText variant="caption" style={{ color: COLORS.textSecondary, fontSize: 11, marginTop: 2 }}>
                            ※ 時間休 {hourlyHours.toFixed(2)}h が年休から消化されます（上限: {maxFurikaeHourly}h）
                          </ThemeText>
                        </View>

                        <View>
                          <ThemeText variant="caption" style={{ marginBottom: 6 }}>時間休の時間数を選択</ThemeText>
                          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                            {[1.0, 2.0, 3.0, 3.5, 3.75].filter(preset => preset <= maxFurikaeHourly).map((preset) => (
                              <TouchableOpacity
                                key={preset}
                                style={[
                                  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.05)' },
                                  hourlyHours === preset && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
                                ]}
                                onPress={() => setHourlyHours(preset)}
                                activeOpacity={0.6}
                              >
                                <ThemeText variant="caption" bold={hourlyHours === preset} color={hourlyHours === preset ? 'white' : COLORS.text}>
                                  {preset}h
                                </ThemeText>
                              </TouchableOpacity>
                            ))}
                          </View>

                          <HourStepper
                            value={hourlyHours}
                            onChange={setHourlyHours}
                            min={0.25}
                            max={maxFurikaeHourly}
                            step={0.25}
                          />
                        </View>
                      </View>
                    ) : (
                      <HourStepper
                        value={selectedHours}
                        onChange={setSelectedHours}
                        min={0.25}
                        max={maxWorkingHours}
                        step={0.25}
                      />
                    )}
                  </View>
                )}

                {(isPrivileged || isAdminAuthenticated) && (
                  <View style={{ marginTop: 20 }}>
                    <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmShift} disabled={isSaving} activeOpacity={0.7}>
                      {isSaving ? <ActivityIndicator color="white" /> : <ThemeText bold color="white">確定</ThemeText>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.placeholderSection}>
                <ThemeText color={COLORS.textSecondary}>日付をタップ</ThemeText>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  calendarModal: { backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  calendarNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, marginBottom: 12 },
  calendarContainer: { backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 8, marginBottom: 16 },
  calendarRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 4 },
  calendarHeaderCell: { width: 44, alignItems: 'center', paddingVertical: 4 },
  calendarDayCell: { width: 44, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 8, padding: 2 },
  calendarDaySelected: { backgroundColor: 'rgba(56, 189, 248, 0.2)', borderWidth: 1, borderColor: '#38bdf8' },
  statusLabelContainer: { minHeight: 18, alignItems: 'center', justifyContent: 'center', width: '100%' },
  statusLabel: { fontSize: 10, textAlign: 'center', width: '100%' },
  editorSection: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 12, marginTop: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  typeBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  input: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: 12, color: 'white', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  confirmBtn: { backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  placeholderSection: { padding: 24, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { padding: 4 },
});
