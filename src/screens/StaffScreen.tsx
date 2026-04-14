import React, { useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Alert, TextInput, SafeAreaView, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { 
  Shield, Users, ChevronLeft, ChevronRight, MapPin, Briefcase, 
  Calendar, Info, AlertCircle, XCircle, Trash2, CheckCircle, 
  Clock, Plus, Filter, Lock, Unlock, Printer, X
} from 'lucide-react-native';
import { getMonthInfo, getDayType, isHoliday, getDateStr } from '../utils/dateUtils';
import { normalizeName } from '../utils/staffUtils';
import { cloudStorage } from '../utils/cloudStorage';
import * as Print from 'expo-print';

interface StaffScreenProps {
  staffList: any[];
  setStaffList: (staff: any[] | ((prev: any[]) => any[])) => void;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  profile: any;
  isAdminAuthenticated: boolean;
  isPrivileged?: boolean;
  onDeleteRequest?: (id: string) => void;
  initialWard?: string;
  currentDate: Date;
  setCurrentDate: (d: Date | ((prev: Date) => Date)) => void;
  staffLocks?: Record<string, Record<string, boolean>>;
  setStaffLocks?: (locks: any) => Promise<void>;
}

interface MonthDay {
  day: number;
  dateStr: string;
  isH?: boolean;
  empty: boolean;
}

export const StaffScreen: React.FC<StaffScreenProps> = (props) => {
  const { staffList, setStaffList, requests, setRequests, onDeleteRequest, isPrivileged, profile, currentDate, setCurrentDate, staffLocks, setStaffLocks } = props;
  const isAdminAuthenticated = props.isAdminAuthenticated || isPrivileged;
  
  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);
  const activeDate = currentDate || new Date();
  const setActiveDate = setCurrentDate;
  
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState('出勤');
  const [selectedHours, setSelectedHours] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Constants
  const SHIFT_TYPES = ['出勤', '公休', '夏季休暇', '時間休', '振替＋時間休', '1日振替', '半日振替', '特休', '年休', '空欄'];
  const HOUR_SELECTOR_TYPES = ['時間休', '振替＋時間休', '特休', '看護休暇', '午前休', '午後休'];

  const monthInfo = useMemo(() => (getMonthInfo(activeDate.getFullYear(), activeDate.getMonth()) || []) as MonthDay[], [activeDate]);
  
  const filteredStaff = useMemo(() => {
    if (!Array.isArray(staffList)) return [];
    return [...staffList.filter(s => s)].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [staffList]);

  const normalize = (s: string) => normalizeName(s || '');

  const getReqHours = (r: any): number => {
    if (!r) return 0;
    const h = r.hours ?? r.details?.duration ?? r.duration;
    if (h !== undefined && h !== null && h !== '') return parseFloat(String(h));
    
    // Default values by type
    if (r.type === '1日振替') return 7.75;
    if (r.type === '半日振替') return 3.75;
    if (['年休', '有給休暇', '夏季休暇', '特休', '全休', '休暇', '欠勤'].includes(r.type)) return 7.75;
    if (r.type === '午前休') return 4.0;
    if (r.type === '午後休') return 3.75;
    
    // Fallback: calculate from details if available
    if (r.details?.startTime && r.details?.endTime) {
      try {
        const [sh, sm] = String(r.details.startTime).split(':').map(Number);
        const [eh, em] = String(r.details.endTime).split(':').map(Number);
        if (!isNaN(sh) && !isNaN(eh)) {
          const hours = (eh + em / 60) - (sh + sm / 60);
          if (hours > 0) return hours;
        }
      } catch (e) {}
    }

    // 最終的な救済措置：0 や NaN を返さない（ただし時間数指定が必要なタイプで 0 を許可するか検討）
    if (r.type === '半日振替') return 3.75;
    return 0;
  };

  const requestMap = useMemo(() => {
    const map = new Map<string, Map<string, any>>();
    if (!Array.isArray(requests)) return map;
    requests.forEach(r => {
      if (!r || !r.date || !r.staffName || r.status === 'deleted') return;
      const dateMap = map.get(r.date) || new Map<string, any>();
      const existing = dateMap.get(normalize(r.staffName));
      
      // Prioritize "leave" types or entries with hours if duplicates exist
      const isBetter = !existing || 
        (getReqHours(r) > 0 && getReqHours(existing) === 0) ||
        (!['出勤', '日勤'].includes(r.type) && ['出勤', '日勤'].includes(existing.type));
        
      if (isBetter) {
        dateMap.set(normalize(r.staffName), r);
      }
      map.set(r.date, dateMap);
    });
    return map;
  }, [requests]);

  const currentMonthKey = `${activeDate.getFullYear()}-${String(activeDate.getMonth() + 1).padStart(2, '0')}`;
  const isMonthLocked = staffLocks?.[selectedStaff?.id]?.[currentMonthKey] === true;

  const handleDayPress = (d: MonthDay) => {
    if (isMonthLocked) {
      Alert.alert('保護されています', `${activeDate.getMonth() + 1}月のカレンダーは保護されているため編集できません。一番右上の「保護中」ボタンを押して解除してください。`);
      return;
    }
    setSelectedDay(d.dateStr);
    const sT = normalize(selectedStaff?.name || '');
    const existing = requestMap.get(d.dateStr)?.get(sT);
    if (existing) {
      setSelectedType((existing.type === '日勤' || existing.type === '出勤' || existing.type === '勤務') ? '出勤' : existing.type);
      setSelectedHours(getReqHours(existing));
    } else {
      const date = new Date(d.dateStr);
      const isWeekday = getDayType(date) === 'weekday';
      setSelectedType(isWeekday ? '出勤' : '公休');
      setSelectedHours(0);
    }
  };

  const handleConfirmShift = async () => {
    if (!selectedDay || !selectedStaff || isSaving) return;

    if (selectedType === '空欄') {
      await handleDeleteCurrentDay(false);
      return;
    }

    setIsSaving(true);
    try {
      const type = selectedType;
      const now = new Date().toISOString();
      const newReq = {
        id: `m-${selectedStaff.id}-${selectedDay}`,
        staffId: selectedStaff.id,
        staffName: selectedStaff.name,
        date: selectedDay,
        type: type,
        hours: HOUR_SELECTOR_TYPES.includes(type) ? selectedHours : undefined,
        status: 'approved',
        createdAt: now,
        updatedAt: now, // 常に最新の時刻をセットして重複排除で勝つようにする
        isShift: true,
        isManual: true // 手動フラグを確実に立てる
      };
      
      const sT = normalize(selectedStaff.name);
      setRequests((prev: any[]) => {
        const without = prev.filter((r: any) => r && !( (String(r.staffId) === selectedStaff.id || normalize(r.staffName) === sT) && r.date === selectedDay ));
        return [newReq, ...without];
      });
      
      await cloudStorage.upsertRequests([newReq]);
      Alert.alert('完了', '保存しました');
    } catch (e) {
      console.error('Confirm Shift Error:', e);
      Alert.alert('エラー', '保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCurrentDay = async (showConfirm = true) => {
    if (!selectedDay || !selectedStaff || isSaving) return;
    const sT = normalize(selectedStaff.name);
    const existing = requests.filter((r: any) => r && ( (String(r.staffId) === selectedStaff.id || normalize(r.staffName) === sT) && r.date === selectedDay ) && r.status !== 'deleted');
    
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
              onDeleteRequest(r.id);
            } else {
              setRequests((prev: any[]) => prev.filter((req: any) => req.id !== r.id));
              await cloudStorage.upsertRequests([{ ...r, status: 'deleted', updatedAt: new Date().toISOString() }]);
            }
          }
        }
        // Instead of setting selectedDay to null and closing everything, just update the state
        setSelectedType('出勤');
        setSelectedHours(0);
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
  };

  const handlePrint = async () => {
    if (!selectedStaff) return;
    
    try {
      const year = activeDate.getFullYear();
      const month = activeDate.getMonth() + 1;
      const sT = normalize(selectedStaff.name);
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
      
      let rowsHtml = '';
      monthInfo.forEach((d: MonthDay) => {
        if (d.empty) return;
        const r = requestMap.get(d.dateStr)?.get(sT);
        
        let type = '';
        if (r) {
          type = r.type;
        } else {
          const dDate = new Date(d.dateStr);
          const dtype = getDayType(dDate);
          const isNoHoliday = (dtype !== 'weekday') && (selectedStaff.monthlyNoHoliday?.[currentMonthKey] ?? selectedStaff.noHoliday);
          type = (dtype === 'weekday') ? '出勤' : (isNoHoliday ? '公休' : '公休');
        }

        const h = r ? getReqHours(r) : 0;
        const shiftDisplay = (HOUR_SELECTOR_TYPES.includes(type)) ? `${type}(${h}h)` : ((type === '日勤' || type === '出勤') ? '出勤' : type);
        
        const dDate = new Date(d.dateStr);
        const dayIdx = dDate.getDay();
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

      const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>個人別勤務実績表</title><style>@page { size: A4 portrait; margin: 10mm; } body { font-family: sans-serif; padding: 20px; color: #1e293b; } .header { border-bottom: 2px solid #38bdf8; padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; } h1 { margin: 0; font-size: 20px; } .meta { font-size: 14px; text-align: right; } table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: center; } th { background-color: #f8fafc; font-size: 13px; font-weight: bold; }</style></head><body><div class="header"><div><h1>個人別勤務実績表 (${month}月)</h1><div style="margin-top: 5px;">氏名: <strong style="font-size: 18px;">${selectedStaff.name}</strong></div></div><div class="meta">${year}年${month}月分<br/>職種: ${selectedStaff.profession}</div></div><table><thead><tr><th style="width: 50px;">日</th><th style="width: 50px;">曜</th><th>勤務実績 / 申請</th><th>特記事項</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;

      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
        } else {
          Alert.alert('ポップアップ制限', '実績表のプレビューが開けませんでした。ブラウザ設定でポップアップを許可してください。');
        }
      } else {
        await Print.printAsync({ html });
      }
    } catch (e) {
      console.error('Print Error:', e);
      Alert.alert('エラー', 'データの生成中に問題が発生しました。');
    }
  };

  const renderCalendar = () => {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return (
      <View style={styles.calendarGrid}>
        {days.map(d => <ThemeText key={d} variant="caption" color={COLORS.textSecondary} style={styles.calendarHeaderCase}>{d}</ThemeText>)}
        {monthInfo.map((d: MonthDay, i: number) => {
          if (!d || d.empty) return <View key={`empty-${i}`} style={styles.calendarDay} />;
          const isSelected = selectedDay === d.dateStr;
          const sT = normalize(selectedStaff?.name || '');
          const req = requestMap.get(d.dateStr)?.get(sT);
          
          let displayLabel = '';
          let labelColor = 'white';
          if (req) {
            const h = getReqHours(req);
            if (['出勤', '日勤', '勤務'].includes(req.type)) {
              displayLabel = '出勤'; labelColor = '#38bdf8';
            } else if (req.type === '公休') {
              displayLabel = '公休'; labelColor = '#ef4444';
            } else if (req.type === '夏季休暇') {
              displayLabel = '夏季'; labelColor = '#ef4444';
            } else if (req.type === '年休' || req.type === '有給休暇') {
              displayLabel = '年休'; labelColor = '#ef4444';
            } else if (req.type === '1日振替') {
              displayLabel = '振(全)'; labelColor = '#ef4444';
            } else if (req.type === '半日振替') {
              displayLabel = '振(半)'; labelColor = '#ef4444';
            } else if (['時間休', '特休', '午前休', '午後休', '振替＋時間休', '看護休暇'].includes(req.type)) {
              const displayH = h;
              displayLabel = `${req.type.charAt(0)}(${displayH}h)`; labelColor = '#ef4444';
            } else {
              displayLabel = req.type.slice(0, 2);
              if (['公休', '欠勤', '休暇', '全休'].includes(req.type)) labelColor = '#ef4444';
            }
          } else {
            // デフォルト表示ロジック（リクエストがない場合）
            const dDate = new Date(d.dateStr);
            const dtype = getDayType(dDate);
            const monthStr = `${dDate.getFullYear()}-${String(dDate.getMonth() + 1).padStart(2, '0')}`;
            const isNoHoliday = (dtype !== 'weekday') && (selectedStaff?.monthlyNoHoliday?.[monthStr] ?? selectedStaff?.noHoliday);
            
            if (dtype === 'weekday') {
              displayLabel = '出勤'; labelColor = '#38bdf8';
            } else {
              displayLabel = '公休'; labelColor = '#ef4444';
            }
          }

          return (
            <TouchableOpacity key={d.dateStr} style={[styles.calendarDay, isSelected && styles.calendarDaySelected]} onPress={() => handleDayPress(d)}>
              <ThemeText bold={isSelected} color={d.isH ? '#ef4444' : 'white'} style={{ fontSize: 13 }}>{d.day}</ThemeText>
              <View style={styles.statusLabelContainer}>
                {displayLabel ? <ThemeText style={[styles.statusLabel, { color: labelColor }]}>{displayLabel}</ThemeText> : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const calculateStats = (staff: any) => {
    if (!staff) return { workDays: 0, holidayWorkDays: 0, leaveHours: '0.00' };
    const sName = normalize(staff.name);
    const year = activeDate.getFullYear();
    const month = activeDate.getMonth();
    const targetMonth = year + '-' + String(month + 1).padStart(2, '0');
    
    // 月の日数を取得
    const daysInMonthCount = new Date(year, month + 1, 0).getDate();
    
    let workDays = 0, holidayWorkDays = 0, leaveHours = 0;
    const attendanceTypes = ['出勤', '日勤', '午前休', '午後休', '時間休', '午前振替', '午後振替', '特休', '看護休暇'];
    const offTypes = ['公休', '振替', '1日振替', '半日振替', '振替休日', '全休'];

    for (let day = 1; day <= daysInMonthCount; day++) {
      const date = new Date(year, month, day);
      const dateStr = getDateStr(date);
      const sT = normalize(staff.name);
      const req = requests.find(r => r && normalize(r.staffName) === sT && r.date === dateStr && r.status !== 'deleted');
      const dtype = getDayType(date);
      
      if (req) {
        // 出勤系（一部でも出勤していれば日数にカウント）
        if (attendanceTypes.includes(req.type)) {
          if (dtype === 'weekday') workDays++; else holidayWorkDays++;
          
          // 時間休などは休暇時間としても加算
          const h = getReqHours(req);
          if (h > 0) leaveHours += h;
        } 
        // 休暇系
        else if (!offTypes.includes(req.type)) {
          const h = getReqHours(req);
          if (h > 0) {
            leaveHours += h;
          } else if (['年休', '有給休暇', '夏季休暇', '休暇', '欠勤'].includes(req.type)) {
            leaveHours += 7.75;
          }
        }
      } else {
        // デフォルトロジック（カレンダーの表示と同一）
        // 平日は出勤、土日祝は休み（休日出勤は申請がない限りカウントしない）
        if (dtype === 'weekday') {
          workDays++;
        }
      }
    }
    return { workDays, holidayWorkDays, leaveHours: leaveHours.toFixed(2) };
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><ThemeText variant="h1">職員名簿</ThemeText></View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: 100 }}>
        <View style={styles.staffGrid}>
          {filteredStaff.map(staff => {
            if (!staff) return null;
            const stats = calculateStats(staff);
            return (
              <ThemeCard key={staff.id} style={[styles.staffCard, staff.status === '長期休暇' && { opacity: 0.6 }]}>
                <View style={styles.cardHeader}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}><ThemeText bold variant="h2" style={{ marginRight: 8 }}>{staff.name}</ThemeText>{staff.position ? ( <View style={styles.badge}><ThemeText style={styles.badgeText}>{staff.position}</ThemeText></View> ) : null}</View>
                    <View style={{ flexDirection: 'row', marginTop: 4, gap: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Briefcase size={12} color={COLORS.textSecondary} /><ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 4 }}>{staff.profession || ''}</ThemeText></View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}><MapPin size={12} color={COLORS.textSecondary} /><ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 4 }}>{staff.placement || ''}</ThemeText></View>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.miniBtn} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}><Calendar size={18} color="#38bdf8" /></TouchableOpacity>
                </View>
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}><ThemeText variant="caption" color={COLORS.textSecondary}>平日</ThemeText><ThemeText bold>{stats.workDays}日</ThemeText></View>
                  <View style={styles.statBox}><ThemeText variant="caption" color={COLORS.textSecondary}>休出</ThemeText><ThemeText bold color="#f87171">{stats.holidayWorkDays}日</ThemeText></View>
                  <View style={styles.statBox}><ThemeText variant="caption" color={COLORS.textSecondary}>休暇(h)</ThemeText><ThemeText bold>{stats.leaveHours}</ThemeText></View>
                </View>
              </ThemeCard>
            );
          })}
        </View>
      </ScrollView>
      <Modal visible={isCalendarModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.calendarModal}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemeText variant="h2">{selectedStaff?.name || ''} さんのカレンダー</ThemeText>
                <ThemeText variant="caption" color={COLORS.textSecondary}>{activeDate.getFullYear()}年 {activeDate.getMonth() + 1}月</ThemeText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {/* 保護（ロック）ボタン */}
                <TouchableOpacity 
                  style={[styles.lockBtn, isMonthLocked && styles.lockBtnActive]}
                  onPress={async () => {
                    if (!selectedStaff || !setStaffLocks) return;
                    
                    const newAllLocks = { ...(staffLocks || {}) };
                    const staffId = String(selectedStaff.id);
                    const staffMonthLocks = { ...(newAllLocks[staffId] || {}) };
                    
                    staffMonthLocks[currentMonthKey] = !isMonthLocked;
                    newAllLocks[staffId] = staffMonthLocks;
                    
                    try {
                      await setStaffLocks(newAllLocks);
                    } catch (e) {
                      console.error('Lock save error:', e);
                    }
                  }}
                >
                  {isMonthLocked ? <Lock size={18} color="white" /> : <Unlock size={18} color={COLORS.textSecondary} />}
                </TouchableOpacity>
                <TouchableOpacity onPress={handlePrint} style={styles.iconBtn}><Printer size={22} color="#38bdf8" /></TouchableOpacity>
                <TouchableOpacity onPress={() => setIsCalendarModalVisible(false)}><X size={24} color={COLORS.textSecondary} /></TouchableOpacity>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              <View style={styles.calendarNav}>
                <TouchableOpacity onPress={() => { setActiveDate(new Date(activeDate.getFullYear(), activeDate.getMonth() - 1, 1)); setSelectedDay(null); }}><ChevronLeft color="white" /></TouchableOpacity>
                <ThemeText bold>{activeDate.getMonth() + 1}月</ThemeText>
                <TouchableOpacity onPress={() => { setActiveDate(new Date(activeDate.getFullYear(), activeDate.getMonth() + 1, 1)); setSelectedDay(null); }}><ChevronRight color="white" /></TouchableOpacity>
              </View>
              {renderCalendar()}
              {selectedDay ? (
                <View style={styles.editorSection}>
                  <ThemeText bold style={{ marginBottom: 12 }}>{selectedDay} の確定</ThemeText>
                  <View style={styles.typeGrid}>{SHIFT_TYPES.map(type => ( <TouchableOpacity key={type} style={[styles.typeBtn, selectedType === type && styles.typeBtnActive]} onPress={() => setSelectedType(type)}><ThemeText bold={selectedType === type} color={selectedType === type ? 'white' : COLORS.textSecondary}>{type}</ThemeText></TouchableOpacity> ))}</View>
                  {HOUR_SELECTOR_TYPES.includes(selectedType) && (
                    <View style={{ marginTop: 12 }}>
                      <ThemeText variant="label" style={{ marginBottom: 12 }}>時間設定 (0.25h単位)</ThemeText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        <TouchableOpacity onPress={() => setSelectedHours(Math.max(0.25, selectedHours - 0.25))} style={styles.addStaffBtn}>
                          <ThemeText bold>-</ThemeText>
                        </TouchableOpacity>
                        <ThemeText variant="h2" color={COLORS.primary}>{selectedHours.toFixed(2)}h</ThemeText>
                        <TouchableOpacity onPress={() => setSelectedHours(Math.min(8.0, selectedHours + 0.25))} style={styles.addStaffBtn}>
                          <ThemeText bold>+</ThemeText>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {(isPrivileged || isAdminAuthenticated) && (
                    <View style={{ marginTop: 20 }}>
                      <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmShift} disabled={isSaving}>
                        {isSaving ? <ActivityIndicator color="white" /> : <ThemeText bold color="white">確定</ThemeText>}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ) : <View style={styles.placeholderSection}><ThemeText color={COLORS.textSecondary}>日付をタップ</ThemeText></View>}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.md, paddingTop: 10 },
  wardScroll: { paddingVertical: 10 },
  wardTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', marginRight: 8 },
  wardTabActive: { backgroundColor: '#38bdf8' },
  staffGrid: { gap: 12 },
  staffCard: { padding: 16, borderRadius: 24, backgroundColor: 'rgba(30, 41, 59, 0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(56, 189, 248, 0.15)', marginRight: 6, marginTop: 4 },
  badgeText: { fontSize: 10, color: '#38bdf8', fontWeight: 'bold' },
  miniBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(56, 189, 248, 0.1)', justifyContent: 'center', alignItems: 'center' },
  iconBtn: { padding: 8, backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: 10 },
  statsGrid: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 16, padding: 12 },
  statBox: { flex: 1, alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  calendarModal: { backgroundColor: '#0f172a', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  calendarNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 },
  calendarHeaderCase: { width: '14.2%', textAlign: 'center', marginBottom: 8 },
  calendarDay: { width: '14.2%', minHeight: 65, justifyContent: 'flex-start', alignItems: 'center', borderRadius: 12, marginBottom: 4, paddingTop: 8 },
  calendarDaySelected: { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderWidth: 1, borderColor: '#38bdf8' },
  statusLabelContainer: { minHeight: 20, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  statusLabel: { fontSize: 9, fontWeight: 'bold', textAlign: 'center' },
  editorSection: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 20 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  typeBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', minWidth: 80, alignItems: 'center' },
  typeBtnActive: { backgroundColor: '#38bdf8' },
  hBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  hBtnActive: { backgroundColor: '#38bdf8' },
  confirmBtn: { backgroundColor: '#38bdf8', padding: 16, borderRadius: 16, alignItems: 'center' },
  placeholderSection: { height: 100, justifyContent: 'center', alignItems: 'center' },
  addStaffBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  deleteBtn: { borderWidth: 1, borderColor: '#ef4444', padding: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  lockBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  lockBtnActive: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
});
