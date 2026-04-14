import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, ScrollView, TouchableOpacity, Modal, Alert, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { ChevronLeft, ChevronRight, Users, Shield, UserMinus, XCircle, Plus, Check, Trash2 } from 'lucide-react-native';
import { getDayType, formatDate, getDateStr, normalizeName } from '../utils/dateUtils';
import { cloudStorage } from '../utils/cloudStorage';

const getSeasonalTheme = (month: number) => {
// ... preserving existing logic ...
// (Wait, replace_file_content replaces lines. Let me just replace the exact imports and button blocks, or do it in multiple chunks).

  const themes: Record<number, { icon: string, color: string }> = {
    0: { icon: '🎍', color: '#be123c' }, // Jan
    1: { icon: '❄️', color: '#0ea5e9' }, // Feb
    2: { icon: '🌸', color: '#f472b6' }, // Mar
    3: { icon: '🌱', color: '#10b981' }, // Apr
    4: { icon: '🎏', color: '#3b82f6' }, // May
    5: { icon: '☔', color: '#6366f1' }, // Jun
    6: { icon: '🎋', color: '#fbbf24' }, // Jul
    7: { icon: '🌻', color: '#f59e0b' }, // Aug
    8: { icon: '🎑', color: '#8b5cf6' }, // Sep
    9: { icon: '🎃', color: '#f97316' }, // Oct
    10: { icon: '🍁', color: '#ea580c' }, // Nov
    11: { icon: '🎄', color: '#ef4444' }, // Dec
  };
  return themes[month] || { icon: '📅', color: COLORS.primary };
};

interface CalendarScreenProps {
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  weekdayLimit: number;
  holidayLimit: number;
  saturdayLimit: number;
  sundayLimit: number;
  publicHolidayLimit: number;
  profile: any;
  staffList: any[];
  isAdminAuthenticated: boolean;
  monthlyLimits: Record<string, { weekday: number, sat: number, sun: number, pub: number }>;
  staffViewMode?: boolean;
  currentDate: Date;
  setCurrentDate: (d: Date | ((prev: Date) => Date)) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteRequests?: (ids: string[]) => void;
  approveRequest?: (id: string, status: string) => void;
  onForceSave?: () => Promise<void>;
  onForceFetch?: () => Promise<void>;
  isSyncing?: boolean;
}

export const CalendarScreen: React.FC<CalendarScreenProps> = ({ 
  requests, setRequests, weekdayLimit, holidayLimit, 
  saturdayLimit, sundayLimit, publicHolidayLimit,
  profile, staffList, isAdminAuthenticated, monthlyLimits, staffViewMode = false,
  currentDate, setCurrentDate, onDeleteRequest, onDeleteRequests, approveRequest,
  onForceSave, onForceFetch, isSyncing = false
}) => {
  const [selectedDate, setSelectedDate] = useState(currentDate || new Date());
  const [isAddStaffModalVisible, setIsAddStaffModalVisible] = useState(false);
  const [selectedStaffToAdd, setSelectedStaffToAdd] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState('出勤');
  const [hourlyDuration, setHourlyDuration] = useState(0);
  const [isTypeModalVisible, setIsTypeModalVisible] = useState(false);

  React.useEffect(() => {
    // Safety check for currentDate
    if (!currentDate || !(currentDate instanceof Date)) return;
    
    // If current selected date is not in the active month, reset it to the 1st of that month
    if (selectedDate.getMonth() !== currentDate.getMonth() || selectedDate.getFullYear() !== currentDate.getFullYear()) {
      setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    }
  }, [currentDate]);

  // Optimization: Index requests to avoid O(N^2) scans in getDetailedDayInfo
  const requestMap = React.useMemo(() => {
    const map = new Map<string, Map<string, any[]>>();
    if (!Array.isArray(requests)) return map;
    
    requests.forEach((r: any) => {
      if (!r || !r.date || !r.staffName || typeof r.staffName !== 'string') return;
      const sT = normalizeName(r.staffName);
      if (!map.has(r.date)) map.set(r.date, new Map<string, any[]>());
      const dateMap = map.get(r.date);
      if (dateMap) {
        if (!dateMap.has(sT)) dateMap.set(sT, []);
        dateMap.get(sT)!.push(r);
      }
    });
    return map;
  }, [requests]);

  const isPrivileged = ((profile?.role?.includes('シフト管理者') || profile?.role?.includes('開発者')) && !staffViewMode) || (isAdminAuthenticated && !staffViewMode);

  const getDetailedDayInfo = (date: Date) => {
    const dateStr = getDateStr(date);
    const dayType = getDayType(date);
    const working: any[] = [];
    const off: any[] = [];
    const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const attendanceTypes = ['出勤', '午前休', '午後休', '時間休', '午前振替', '午後振替', '特休', '看護休暇'];

    (staffList || []).forEach(staff => {
      if (!staff || !staff.name) return;
      
      const isOut = normalizeName(staff.status) === '長期休暇' || normalizeName(staff.placement) === '長期休暇' || normalizeName(staff.position) === '長期休暇' || normalizeName(staff.status) === '入職前';
      const isHomeVisit = staff.placement === '訪問';
      const isAssistant = staff.profession === '助手' || staff.placement === '助手';
      
      if (isOut) return;

      const userRequests = requestMap.get(dateStr)?.get(normalizeName(staff.name)) || [];
      const approvedReqs = userRequests.filter(r => r.status === 'approved');
      const pendingReqs = userRequests.filter(r => r.status === 'pending');
      const isNoHoliday = (dayType !== 'weekday') && (staff.monthlyNoHoliday?.[monthStr] ?? staff.noHoliday);

      if (approvedReqs.length > 0) {
        approvedReqs.forEach(req => {
          const isAtt = attendanceTypes.includes(req.type);
          if (isAtt) {
            if (!isAssistant) {
              working.push({ staff, type: req.type, requestId: req.id, isManual: true, isHomeVisit, status: 'approved', details: req.details });
            }
            if (req.type !== '出勤') {
              off.push({ staff, type: req.type, requestId: req.id, isManual: true, isHomeVisit, status: 'approved', details: req.details });
            }
          } else {
            off.push({ staff, type: req.type, requestId: req.id, isManual: true, isHomeVisit, status: 'approved', details: req.details });
          }
        });
      } else if (pendingReqs.length > 0) {
        pendingReqs.forEach(req => {
          const list = attendanceTypes.includes(req.type) ? working : off;
          list.push({ staff, type: req.type, requestId: req.id, isManual: true, isHomeVisit, status: 'pending', details: req.details });
          if (list === working && req.type !== '出勤') {
            off.push({ staff, type: req.type, requestId: req.id, isManual: true, isHomeVisit, status: 'pending', details: req.details });
          }
        });
      } else {
        const isScheduledToWork = dayType === 'weekday';
        if (isScheduledToWork) {
          working.push({ staff, type: '出勤', requestId: `auto-${staff.id}`, isManual: false, isHomeVisit, status: 'approved' });
        } else {
          off.push({ staff, type: isNoHoliday ? '休日出勤不要' : '公休', requestId: `auto-${staff.id}`, isManual: false, isHomeVisit, status: 'approved' });
        }
      }
    });

    return { working, off };
  };

  // その月の全日分の情報を事前計算する（描画高速化のため）
  const monthDataMap = React.useMemo(() => {
    const dataMap = new Map();
    const safeDate = currentDate || new Date();
    const daysInMonthCnt = new Date(safeDate.getFullYear(), safeDate.getMonth() + 1, 0).getDate();
    
    for (let day = 1; day <= daysInMonthCnt; day++) {
      const d = new Date(safeDate.getFullYear(), safeDate.getMonth(), day);
      const info = getDetailedDayInfo(d);
      const dayType = getDayType(d);
      
      dataMap.set(day, {
        workingCount: info.working.filter(w => !w.isHomeVisit).length,
        holidayWorkers: dayType !== 'weekday' ? info.working.filter(w => !w.isHomeVisit).map(w => w.staff.name) : [],
        dayType
      });
    }
    return dataMap;
  }, [currentDate, staffList, requestMap, monthlyLimits, weekdayLimit, saturdayLimit, sundayLimit, publicHolidayLimit]);

  const { working: workingStaff, off: offStaff } = getDetailedDayInfo(selectedDate || new Date());
  const currentDayType = getDayType(selectedDate || new Date());
  const safeSelectedDate = selectedDate || new Date();
  const monthStr = `${safeSelectedDate.getFullYear()}-${String(safeSelectedDate.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthly = (monthlyLimits && monthlyLimits[monthStr]) || { weekday: weekdayLimit || 0, sat: saturdayLimit || 0, sun: sundayLimit || 0, pub: publicHolidayLimit || 0 };
  const currentLimit = currentDayType === 'weekday' ? currentMonthly.weekday : 
                       currentDayType === 'sat' ? currentMonthly.sat :
                       currentDayType === 'sun' ? currentMonthly.sun :
                       currentMonthly.pub;

  const handleDeleteShift = async (staffName: string, requestId: string, isManual: boolean, wasWorking: boolean) => {
    Alert.alert(
      'シフトの解除・調整',
      `${staffName} さんの当日の予定を削除または変更しますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        { 
          text: '実行する', 
          style: 'destructive', 
          onPress: async () => {
            const dateStr = getDateStr(selectedDate);
            const dayType = getDayType(selectedDate);
            
            // 1. 対象スタッフ・対象日のリクエストをすべて特定 (手動/自動問わず削除対象とする)
            const manualRequestIds = requests
              .filter(r => normalizeName(r.staffName) === normalizeName(staffName) && r.date === dateStr)
              .map(r => r.id);

            // 2. クラウド/グローバルステートから一括削除
            if (manualRequestIds.length > 0) {
              if (onDeleteRequests) {
                await onDeleteRequests(manualRequestIds);
              } else {
                for (const id of manualRequestIds) {
                  await onDeleteRequest(id);
                }
              }
            }

            // 3. ローカルステートの更新と「状態保持（公休化）」
            setRequests((prev: any[]) => {
              // まず対象の全リクエストをフィルタリング
              const filtered = prev.filter(r => !(normalizeName(r.staffName) === normalizeName(staffName) && r.date === dateStr));
              
              // 平日で「出勤」を削除した場合のみ、「公休（休み）」として状態を上書き保持する
              if (wasWorking && dayType === 'weekday') {
                const offRequest = {
                  id: `off-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  staffName: staffName,
                  date: dateStr,
                  type: '公休',
                  status: 'approved',
                  reason: '調整',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                return [...filtered, offRequest];
              }
              return filtered;
            });

            Alert.alert('完了', 'シフトの解除・調整が完了しました。');
          }
        }
      ]
    );
  };

  const handleAddStaff = async (staffNames: string[]) => {
    const dateStr = getDateStr(selectedDate);

    if (selectedType === '空欄') {
      const idsToDelete = requests
        .filter(r => r.date === dateStr && staffNames.map(n => normalizeName(n)).includes(normalizeName(r.staffName)))
        .map(r => r.id);
      
      if (idsToDelete.length > 0) {
        if (onDeleteRequests) {
          await onDeleteRequests(idsToDelete);
        } else {
          for (const id of idsToDelete) {
            await onDeleteRequest(id);
          }
        }
        
        setRequests((prev: any[]) => prev.filter(r => !idsToDelete.includes(r.id)));
        Alert.alert('完了', 'シフトをクリアしました。');
      }
      setIsAddStaffModalVisible(false);
      setIsTypeModalVisible(false);
      setSelectedStaffToAdd([]);
      return;
    }

    const newReqs = staffNames.map(name => ({
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      staffName: name,
      date: dateStr,
      type: selectedType,
      status: 'approved',
      reason: '管理者による調整',
      details: { 
        note: '手動割当',
        duration: (selectedType === '時間休' || selectedType === '特休' || selectedType === '看護休暇') ? hourlyDuration : undefined
      },
      createdAt: new Date().toISOString(),
    }));
    setRequests((prev: any[]) => [...prev, ...newReqs]);
    setIsAddStaffModalVisible(false);
    setIsTypeModalVisible(false);
    setSelectedStaffToAdd([]);
    setSelectedType('出勤');
  };

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const safeCurrentDate = currentDate || new Date();
  const daysInMonth = getDaysInMonth(safeCurrentDate.getFullYear(), safeCurrentDate.getMonth());
  const firstDayOfMonth = getFirstDayOfMonth(safeCurrentDate.getFullYear(), safeCurrentDate.getMonth());

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const renderCalendar = () => {
    const rows: any[] = [];
    let cells: any[] = [];

    days.forEach((day, i) => {
      if (i > 0 && i % 7 === 0) {
        rows.push(<View key={`row-${i}`} style={styles.calendarRow}>{cells}</View>);
        cells = [];
      }

      const isSelected = day === safeSelectedDate.getDate() && safeCurrentDate.getMonth() === safeSelectedDate.getMonth() && safeCurrentDate.getFullYear() === safeSelectedDate.getFullYear();
      const isToday = day === new Date().getDate() && 
                      safeCurrentDate.getMonth() === new Date().getMonth() && 
                      safeCurrentDate.getFullYear() === new Date().getFullYear();
      
      const dayData = day ? monthDataMap.get(day) : null;
      const dayType = dayData?.dayType || getDayType(new Date(safeCurrentDate.getFullYear(), safeCurrentDate.getMonth(), day || 1));
      const monthly = (monthlyLimits && monthlyLimits[monthStr]) || { weekday: weekdayLimit || 0, sat: saturdayLimit || 0, sun: sundayLimit || 0, pub: publicHolidayLimit || 0 };
      const limit = dayType === 'weekday' ? monthly.weekday : 
                    dayType === 'sat' ? monthly.sat :
                    dayType === 'sun' ? monthly.sun :
                    monthly.pub;

      let dateColor = COLORS.text;
      if (dayType === 'sun' || dayType === 'holiday') dateColor = '#ef4444';
      if (dayType === 'sat') dateColor = '#3b82f6';

      const workingCount = dayData ? dayData.workingCount : 0;
      const holidayWorkers = dayData ? dayData.holidayWorkers : [];
      const isUnderLimit = workingCount < limit;

      cells.push(
        <TouchableOpacity 
          key={`day-${i}`} 
          style={[
            styles.dayCell, 
            isSelected && styles.selectedDay, 
            isToday && !isSelected && styles.todayCell,
            (!isSelected && !!day && isUnderLimit) ? { backgroundColor: 'rgba(59, 130, 246, 0.05)', borderRadius: BORDER_RADIUS.sm } : null
          ]}
          onPress={() => day && setSelectedDate(new Date(safeCurrentDate.getFullYear(), safeCurrentDate.getMonth(), day))}
          disabled={!day}
        >
          {day && (
            <>
              <ThemeText 
                variant="caption" 
                style={{ color: isSelected ? COLORS.background : dateColor, fontWeight: isSelected || isToday ? 'bold' : 'normal', fontSize: 10 }}
              >
                {day}
              </ThemeText>

              <ThemeText 
                variant="caption" 
                style={[
                  styles.dayCount, 
                  { color: isSelected ? COLORS.background : (workingCount > limit ? '#ef4444' : isUnderLimit ? '#3b82f6' : COLORS.textSecondary) }
                ]}
              >
                {workingCount}/{limit}
              </ThemeText>

              {holidayWorkers.length > 0 && (
                <View style={styles.holidayWorkersBox}>
                  {holidayWorkers.slice(0, 3).map((name, idx) => (
                    <ThemeText 
                      key={idx} 
                      style={[styles.holidayWorkerName, isSelected && { color: 'white' }]} 
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {name}
                    </ThemeText>
                  ))}
                  {holidayWorkers.length > 3 && (
                    <ThemeText style={[styles.holidayWorkerName, { opacity: 0.6, fontSize: 8 }, isSelected && { color: 'white' }]}>他{holidayWorkers.length - 3}名</ThemeText>
                  )}
                </View>
              )}
            </>
          )}
        </TouchableOpacity>
      );
    });

    if (cells.length > 0) {
      while (cells.length < 7) cells.push(<View key={`empty-${cells.length}`} style={styles.dayCell} />);
      rows.push(<View key="last-row" style={styles.calendarRow}>{cells}</View>);
    }
    return rows;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 160 }} showsVerticalScrollIndicator={true}>
        <View style={styles.header}>
          <ThemeText variant="h1">カレンダー</ThemeText>
          <ThemeText variant="caption">シフト・稼働予定の確認</ThemeText>
        </View>

        <ThemeCard style={styles.calendarContainer}>
          <View style={styles.monthHeader}>
            <TouchableOpacity onPress={() => currentDate && setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}>
              <ChevronLeft color={COLORS.text} size={24} />
            </TouchableOpacity>
            
            <View style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <ThemeText style={{ fontSize: 24 }}>{getSeasonalTheme(currentDate?.getMonth() || 0).icon}</ThemeText>
                <ThemeText variant="h2">{currentDate?.getFullYear() || 2026}年 {(currentDate?.getMonth() || 0) + 1}月</ThemeText>
              </View>

              {/* 同期・更新ボタン - 全ユーザーが見られるが保存は管理者のみ */}
                <View style={[styles.syncContainer, { marginTop: 12 }]}>
                  {isPrivileged && (
                    <TouchableOpacity 
                      style={[
                        styles.syncBtn, 
                        { borderColor: COLORS.primary, backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 16 },
                        isSyncing && { opacity: 0.5 }
                      ]}
                      disabled={isSyncing}
                      onPress={() => {
                        if (Platform.OS === 'web') {
                          if (window.confirm('現在のこの端末の状態をクラウドに強制保存します。スマホなど他の端末の内容はこの内容で上書きされますが、よろしいですか？')) onForceSave();
                        } else {
                          Alert.alert(
                            'クラウドに保存',
                            '現在のこの端末の状態をクラウドに強制保存します。スマホなど他の端末の内容はこの内容で上書きされますが、よろしいですか？',
                            [{ text: 'キャンセル', style: 'cancel' }, { text: '保存する', onPress: onForceSave }]
                          );
                        }
                      }}
                    >
                      <ThemeText variant="caption" color={COLORS.primary} bold>
                        {isSyncing ? '処理中...' : 'クラウドに保存'}
                      </ThemeText>
                    </TouchableOpacity>
                  )}
                  {/* 「更新」ボタンは一般スタッフにも開放し、スマホでの同期を容易にする */}
                  {(isPrivileged || profile) && (
                    <TouchableOpacity 
                      style={[
                        styles.syncBtn, 
                        { borderColor: COLORS.textSecondary, backgroundColor: 'rgba(255, 255, 255, 0.05)', paddingHorizontal: 16 },
                        isSyncing && { opacity: 0.5 }
                      ]}
                      disabled={isSyncing}
                      onPress={() => {
                        if (Platform.OS === 'web') {
                          if (window.confirm('クラウドから最新のデータを取得します。現在のローカルの変更は破棄されますが、よろしいですか？')) onForceFetch();
                        } else {
                          Alert.alert(
                            'クラウドから更新',
                            'クラウドから最新のデータを取得します。現在のローカルの変更は破棄されますが、よろしいですか？',
                            [{ text: 'キャンセル', style: 'cancel' }, { text: '更新する', onPress: onForceFetch }]
                          );
                        }
                      }}
                    >
                      <ThemeText variant="caption" color={COLORS.textSecondary} bold>
                        {isSyncing ? '処理中...' : 'クラウドから更新'}
                      </ThemeText>
                    </TouchableOpacity>
                  )}
                </View>

            </View>

            <TouchableOpacity onPress={() => currentDate && setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}>
              <ChevronRight color={COLORS.text} size={24} />
            </TouchableOpacity>
          </View>

        <View style={styles.weekDays}>
          {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
            <ThemeText key={d} variant="caption" style={[styles.weekDayText, i === 0 && { color: '#ef4444' }, i === 6 && { color: '#3b82f6' }]}>{d}</ThemeText>
          ))}
        </View>

        <View style={styles.calendarGrid}>
          {renderCalendar()}
        </View>
      </ThemeCard>

      <View style={styles.detailScroll}>
        <ThemeCard style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <ThemeText variant="h2">{safeSelectedDate.getMonth() + 1}月{safeSelectedDate.getDate()}日の詳細</ThemeText>
            {isPrivileged && (
              <TouchableOpacity 
                style={styles.addStaffBtn} 
                onPress={() => setIsAddStaffModalVisible(true)}
              >
                <Plus size={16} color={COLORS.primary} />
                <ThemeText variant="caption" color={COLORS.primary} bold style={{ marginLeft: 4 }}>スタッフ追加</ThemeText>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.detailRow}>
            <View style={styles.detailItem}>
              <View style={styles.detailTitleRow}><Users size={16} color={COLORS.primary} /><ThemeText variant="label" style={{ marginLeft: 8 }}>現在の出勤数</ThemeText></View>
              <ThemeText variant="h1">
                {workingStaff.filter(w => !w.isHomeVisit).length}
                <ThemeText variant="caption"> 名</ThemeText>
              </ThemeText>
            </View>
            <View style={styles.detailItem}>
              <View style={styles.detailTitleRow}><Shield size={16} color={COLORS.accent} /><ThemeText variant="label" style={{ marginLeft: 8 }}>目標・制限数</ThemeText></View>
              <ThemeText variant="h1" color={COLORS.accent}>{currentLimit}<ThemeText variant="caption" color={COLORS.accent}> 名</ThemeText></ThemeText>
            </View>
          </View>

            {/* Working Staff Section - Only show names for Holidays */}
            <View style={styles.leavesSection}>
              <View style={styles.sectionDivider} />
              <View style={styles.leavesTitleRow}><Users size={16} color={COLORS.primary} /><ThemeText variant="label" style={{ color: COLORS.primary, marginLeft: 8 }}>出勤者一覧</ThemeText></View>
              {workingStaff.length > 0 ? workingStaff.map((item, idx) => (
                <View key={idx} style={styles.leafItem}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                    <ThemeText variant="caption" bold>{item.staff?.name || '不明'}</ThemeText>
                    {item.isHomeVisit && <View style={[styles.badgeTiny, { backgroundColor: '#ec4899' }]}><ThemeText style={styles.badgeTinyText}>訪問</ThemeText></View>}
                    {(item.staff?.profession === '助手' || item.staff?.placement === '助手') && <View style={[styles.badgeTiny, { backgroundColor: '#8b5cf6' }]}><ThemeText style={styles.badgeTinyText}>助手</ThemeText></View>}
                    <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginLeft: 8 }} numberOfLines={1}>
                      ({item.type})
                      {item.details?.startTime && <ThemeText variant="caption" style={{ color: COLORS.accent, fontWeight: 'bold' }}> {item.details.startTime}-{item.details.endTime}</ThemeText>}
                      {(!item.details?.startTime && item.details?.duration) && <ThemeText variant="caption" style={{ color: COLORS.accent, fontWeight: 'bold' }}> {item.details.duration}h</ThemeText>}
                      {item.status === 'pending' && <ThemeText variant="caption" style={{ color: '#f59e0b', fontWeight: 'bold' }}> [申請中]</ThemeText>}
                    </ThemeText>
                  </View>
                  {(isPrivileged || (profile && item.staff && normalizeName(profile.name) === normalizeName(item.staff.name))) && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {item.status === 'pending' && (
                        <TouchableOpacity 
                          style={[styles.smallActionBtn, { borderColor: COLORS.primary, backgroundColor: 'rgba(56, 189, 248, 0.05)' }]}
                          onPress={() => item.requestId && approveRequest && approveRequest(item.requestId, 'approved')}
                        >
                          <Check size={14} color={COLORS.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              )) : (
                <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginTop: 4, marginLeft: 8 }}>出勤予定なし</ThemeText>
              )}
            </View>

          {/* Off Staff Section */}
          <View style={styles.leavesSection}>
            <View style={styles.sectionDivider} />
            <View style={styles.leavesTitleRow}><UserMinus size={16} color="#ef4444" /><ThemeText variant="label" style={{ color: '#ef4444', marginLeft: 8 }}>休暇・休日</ThemeText></View>
            {offStaff.length > 0 ? offStaff.map((item, idx) => (
                <View key={idx} style={styles.leafItem}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                    <ThemeText variant="caption" bold style={{ color: COLORS.textSecondary }}>{item.staff?.name || '不明'}</ThemeText>
                    {item.isHomeVisit && <View style={[styles.badgeTiny, { backgroundColor: '#ec4899' }]}><ThemeText style={styles.badgeTinyText}>訪問</ThemeText></View>}
                    {(item.staff?.profession === '助手' || item.staff?.placement === '助手') && <View style={[styles.badgeTiny, { backgroundColor: '#8b5cf6' }]}><ThemeText style={styles.badgeTinyText}>助手</ThemeText></View>}
                    <ThemeText variant="caption" style={{ marginLeft: 8, color: COLORS.textSecondary }} numberOfLines={1}>
                      ({item.type})
                      {item.details?.startTime && <ThemeText variant="caption" style={{ color: COLORS.accent }}> {item.details.startTime}-{item.details.endTime}</ThemeText>}
                      {(!item.details?.startTime && item.details?.duration) && <ThemeText variant="caption" style={{ color: COLORS.accent }}> {item.details.duration}h</ThemeText>}
                      {item.status === 'pending' && <ThemeText variant="caption" style={{ color: '#f59e0b', fontWeight: 'bold' }}> [申請中]</ThemeText>}
                    </ThemeText>
                  </View>
                  {(isPrivileged || (profile?.name && item.staff && normalizeName(profile.name) === normalizeName(item.staff.name))) && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {item.status === 'pending' && (
                        <TouchableOpacity 
                          style={[styles.smallActionBtn, { borderColor: COLORS.primary, backgroundColor: 'rgba(56, 189, 248, 0.05)' }]}
                          onPress={() => item.requestId && approveRequest && approveRequest(item.requestId, 'approved')}
                        >
                          <Check size={14} color={COLORS.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
            )) : (
              <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginTop: 4, marginLeft: 8 }}>休暇者なし</ThemeText>
            )}
          </View>

        </ThemeCard>
      </View>
      </ScrollView>

      {/* Staff Assignment Modal */}
      <Modal visible={isAddStaffModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <ThemeText variant="h2">スタッフを出勤に割り当て</ThemeText>
                <ThemeText variant="caption">{formatDate(safeSelectedDate)}</ThemeText>
              </View>
              <TouchableOpacity onPress={() => setIsAddStaffModalVisible(false)}>
                <XCircle color={COLORS.textSecondary} size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 400 }}>
              {(staffList || [])
                .filter(s => {
                  const safeDateForModal = currentDate || new Date();
                  const mStr = `${safeDateForModal.getFullYear()}-${String(safeDateForModal.getMonth() + 1).padStart(2, '0')}`;
                  const isLongTerm = normalizeName(s.status) === '長期休暇' || normalizeName(s.placement) === '長期休暇' || normalizeName(s.position) === '長期休暇' || normalizeName(s.status) === '入職前';
                  const isNoHoliday = (getDayType(safeSelectedDate) !== 'weekday') && (s.monthlyNoHoliday?.[mStr] ?? s.noHoliday);
                  const alreadyHasRequest = requests && Array.isArray(requests) && requests.some(r => normalizeName(r.staffName) === normalizeName(s.name) && r.date === getDateStr(safeSelectedDate) && r.status === 'approved');
                  
                  return !isLongTerm && !isNoHoliday && !alreadyHasRequest;
                })
                .map((staff, idx) => {
                  const isSelected = selectedStaffToAdd.includes(staff.name);
                  return (
                    <TouchableOpacity 
                      key={staff.id || idx} 
                      style={[styles.staffSelectOption, isSelected && styles.staffSelectOptionActive]}
                      onPress={() => {
                        if (isSelected) {
                          setSelectedStaffToAdd(selectedStaffToAdd.filter(n => n !== staff.name));
                        } else {
                          setSelectedStaffToAdd([...selectedStaffToAdd, staff.name]);
                        }
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <ThemeText variant="body" bold={!isSelected} color={isSelected ? 'white' : COLORS.text}>{staff.name}</ThemeText>
                        <ThemeText variant="caption" color={isSelected ? 'white' : COLORS.textSecondary}>{staff.placement} / {staff.profession}</ThemeText>
                      </View>
                      {isSelected && <Check color="white" size={20} />}
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalCancelButton]} 
                onPress={() => setIsAddStaffModalVisible(false)}
              >
                <ThemeText bold>キャンセル</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalSubmitButton]} 
                onPress={() => setIsTypeModalVisible(true)}
                disabled={selectedStaffToAdd.length === 0}
              >
                <ThemeText bold color="white">次へ ({selectedStaffToAdd.length}名)</ThemeText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Type Selection Modal */}
      <Modal visible={isTypeModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { padding: 24 }]}>
            <View style={{ marginBottom: 20 }}>
              <ThemeText variant="h2">種別を選択</ThemeText>
              <ThemeText variant="caption">{selectedStaffToAdd.join(', ')}</ThemeText>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
              {['出勤', '午前休', '午後休', '時間休', '午前振替', '午後振替', '公休', '特休', '年休', '看護休暇', '空欄'].map(t => (
                <TouchableOpacity 
                  key={t}
                  style={[
                    { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.05)' },
                    selectedType === t && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
                  ]}
                  onPress={() => setSelectedType(t)}
                >
                  <ThemeText color={selectedType === t ? 'white' : COLORS.text} bold={selectedType === t}>{t}</ThemeText>
                </TouchableOpacity>
              ))}
            </View>

            {(selectedType === '時間休' || selectedType === '特休' || selectedType === '看護休暇') && (
              <View style={{ marginBottom: 20 }}>
                <ThemeText variant="label" style={{ marginBottom: 8 }}>時間設定 (15分単位)</ThemeText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <TouchableOpacity onPress={() => setHourlyDuration(Math.max(0.25, hourlyDuration - 0.25))} style={styles.addStaffBtn}>
                    <ThemeText bold>-</ThemeText>
                  </TouchableOpacity>
                  <ThemeText variant="h2" color={COLORS.primary}>{hourlyDuration.toFixed(2)}h</ThemeText>
                  <TouchableOpacity onPress={() => setHourlyDuration(Math.min(8.0, hourlyDuration + 0.25))} style={styles.addStaffBtn}>
                    <ThemeText bold>+</ThemeText>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, styles.modalCancelButton]} onPress={() => setIsTypeModalVisible(false)}>
                <ThemeText>戻る</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalSubmitButton]} onPress={() => handleAddStaff(selectedStaffToAdd)}>
                <ThemeText bold color="white">確定する</ThemeText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.md, marginTop: SPACING.md },
  calendarContainer: { margin: SPACING.md, padding: SPACING.md },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg, flexWrap: 'wrap', gap: 10 },
  syncContainer: { flexDirection: 'row', gap: 12, marginVertical: 4 },
  weekDays: { flexDirection: 'row', marginBottom: SPACING.sm },
  weekDayText: { flex: 1, textAlign: 'center', color: COLORS.textSecondary },
  calendarGrid: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  calendarRow: { flexDirection: 'row', height: 110, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  dayCell: { flex: 1, padding: 2, alignItems: 'center', justifyContent: 'flex-start' },
  selectedDay: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md },
  todayCell: { backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.primary },
  dayCount: { fontSize: 9.5, marginTop: 1, fontWeight: 'bold' },
  holidayWorkersBox: { width: '100%', marginTop: 3, paddingHorizontal: 2, alignItems: 'center', gap: 2 },
  holidayWorkerName: { fontSize: 10, color: COLORS.text, fontWeight: 'bold', width: '100%', textAlign: 'center' },
  requestBadge: { backgroundColor: '#ef4444', borderRadius: 4, paddingHorizontal: 2, paddingVertical: 1, marginTop: 1, alignItems: 'center', justifyContent: 'center', width: '90%' },
  requestText: { color: 'white', fontSize: 7, fontWeight: 'bold', textAlign: 'center' },
  detailScroll: { paddingHorizontal: SPACING.md },
  detailCard: { padding: SPACING.md, marginBottom: 100 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  detailRow: { flexDirection: 'row', gap: SPACING.lg, marginTop: 8 },
  detailTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  detailItem: { flex: 1 },
  leavesSection: { marginTop: SPACING.md },
  sectionDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: SPACING.md },
  leavesTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  leafItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, paddingLeft: 8 },
  addStaffBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: BORDER_RADIUS.sm },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 24, padding: 24, width: '100%', borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  staffSelectOption: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  staffSelectOptionActive: { backgroundColor: COLORS.primary, borderRadius: 8 },
  modalButtons: { flexDirection: 'row', gap: SPACING.md, marginTop: 24 },
  modalButton: { flex: 1, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  modalCancelButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border },
  modalSubmitButton: { backgroundColor: COLORS.primary },
  smallActionBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, backgroundColor: 'rgba(239, 68, 68, 0.05)', zIndex: 10 },
  finishBtn: { backgroundColor: COLORS.primary, height: 54, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4, zIndex: 20 },
  badgeTiny: { paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, marginLeft: 6, marginBottom: 1 },
  badgeTinyText: { color: 'white', fontSize: 9.5, fontWeight: 'bold' },
  syncBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.02)' },
});
