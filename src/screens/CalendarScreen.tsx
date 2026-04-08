import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { ChevronLeft, ChevronRight, Users, Shield, UserMinus, XCircle, Plus, Check, Trash2 } from 'lucide-react-native';
import { getDayType, formatDate, getDateStr } from '../utils/dateUtils';
import { cloudStorage } from '../utils/cloudStorage';

const getSeasonalTheme = (month: number) => {
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
}

export const CalendarScreen: React.FC<CalendarScreenProps> = ({ 
  requests, setRequests, weekdayLimit, holidayLimit, 
  saturdayLimit, sundayLimit, publicHolidayLimit,
  profile, staffList, isAdminAuthenticated, monthlyLimits, staffViewMode = false,
  currentDate, setCurrentDate, onDeleteRequest 
}) => {
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [isAddStaffModalVisible, setIsAddStaffModalVisible] = useState(false);
  const [selectedStaffToAdd, setSelectedStaffToAdd] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState('出勤');
  const [hourlyDuration, setHourlyDuration] = useState(1.0);
  const [isTypeModalVisible, setIsTypeModalVisible] = useState(false);

  React.useEffect(() => {
    // If current selected date is not in the active month, reset it to the 1st of that month
    if (selectedDate.getMonth() !== currentDate.getMonth() || selectedDate.getFullYear() !== currentDate.getFullYear()) {
      setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    }
  }, [currentDate]);

  // Optimization: Index requests to avoid O(N^2) scans in getDetailedDayInfo
  const requestMap = React.useMemo(() => {
    const map = new Map<string, Map<string, any[]>>();
    requests.forEach((r: any) => {
      if (!r.date || !r.staffName) return;
      const sT = r.staffName.trim();
      if (!map.has(r.date)) map.set(r.date, new Map<string, any[]>());
      if (!map.get(r.date)!.has(sT)) map.get(r.date)!.set(sT, []);
      map.get(r.date)!.get(sT)!.push(r);
    });
    return map;
  }, [requests]);

  const isPrivileged = ((profile.role?.includes('シフト管理者') || profile.role?.includes('開発者')) && !staffViewMode) || (isAdminAuthenticated && !staffViewMode);

  const getDetailedDayInfo = (date: Date) => {
    const dateStr = getDateStr(date);
    const dayType = getDayType(date);
    const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    const working: any[] = [];
    const off: any[] = [];

    staffList.forEach(staff => {
      const isOut = staff.status?.trim() === '長期休暇' || staff.placement?.trim() === '長期休暇' || staff.position?.trim() === '長期休暇' || staff.status?.trim() === '入職前';
      const isHomeVisit = staff.placement === '訪問';
      const isAssistant = staff.profession === '助手' || staff.placement === '助手';
      
      // 除外条件: 長期休暇、入職前、訪問担当
      if (isOut || isHomeVisit) return;

      const userRequests = requestMap.get(dateStr)?.get(staff.name?.trim()) || [];
      const attendanceTypes = ['出勤', '午前休', '午後休', '時間休', '時間給', '午前振替', '午後振替', '特休', '看護休暇'];
      
      // 休暇申請（公休含む）を優先的に探す
      const leaveRequest = userRequests.find(r => !attendanceTypes.includes(r.type) && r.status === 'approved');
      const workRequest = userRequests.find(r => attendanceTypes.includes(r.type) && r.status === 'approved');
      const pendingRequest = userRequests.find(r => r.status === 'pending');

      const isNoHoliday = (dayType !== 'weekday') && (staff.monthlyNoHoliday?.[monthStr] ?? staff.noHoliday);

      // ロジックの優先順位: 1. 休暇申請 2. 出勤申請 3. デフォルト（平日: 出勤 / 休日: 公休）
      if (leaveRequest) {
        off.push({ staff, type: leaveRequest.type, requestId: leaveRequest.id, isManual: true, isHomeVisit, status: 'approved', details: leaveRequest.details });
      } else if (workRequest) {
        if (isAssistant) {
          // 助手の場合、「出勤」以外の特殊な勤怠（午前休、特休など）なら休暇リストに表示して把握可能にする
          if (workRequest.type !== '出勤') {
            off.push({ staff, type: workRequest.type, requestId: workRequest.id, isManual: true, isHomeVisit, status: 'approved', details: workRequest.details });
          }
        } else {
          working.push({ staff, type: workRequest.type, requestId: workRequest.id, isManual: true, isHomeVisit, status: 'approved', details: workRequest.details });
          // 時間休などは出勤しつつ休暇扱いとなるため、休暇・休日リスト（off）にも表示させる
          if (workRequest.type !== '出勤') {
            off.push({ staff, type: workRequest.type, requestId: workRequest.id, isManual: true, isHomeVisit, status: 'approved', details: workRequest.details });
          }
        }
      } else if (pendingRequest) {
        // Show pending on the side they apply to
        const list = attendanceTypes.includes(pendingRequest.type) ? working : off;
        if (isAssistant) {
          if (pendingRequest.type !== '出勤') {
            off.push({ staff, type: pendingRequest.type, requestId: pendingRequest.id, isManual: true, isHomeVisit, status: 'pending', details: pendingRequest.details });
          }
        } else {
          list.push({ staff, type: pendingRequest.type, requestId: pendingRequest.id, isManual: true, isHomeVisit, status: 'pending', details: pendingRequest.details });
          // ペンディングであっても「出勤」以外なら両方に表示させる
          if (list === working && pendingRequest.type !== '出勤') {
            off.push({ staff, type: pendingRequest.type, requestId: pendingRequest.id, isManual: true, isHomeVisit, status: 'pending', details: pendingRequest.details });
          }
        }
      } else {
        if (!isAssistant) {
          const isScheduledToWork = dayType === 'weekday';
          if (isScheduledToWork) {
            working.push({ staff, type: '出勤', requestId: `auto-${staff.id}`, isManual: false, isHomeVisit, status: 'approved' });
          } else {
            off.push({ staff, type: isNoHoliday ? '休日出勤不要' : '公休', requestId: `auto-${staff.id}`, isManual: false, isHomeVisit, status: 'approved' });
          }
        }
      }
    });

    return { working, off };
  };

  const { working: workingStaff, off: offStaff } = getDetailedDayInfo(selectedDate);
  const currentDayType = getDayType(selectedDate);
  const monthStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthly = monthlyLimits[monthStr] || { weekday: weekdayLimit, sat: saturdayLimit, sun: sundayLimit, pub: publicHolidayLimit };
  const currentLimit = currentDayType === 'weekday' ? currentMonthly.weekday : 
                       currentDayType === 'sat' ? currentMonthly.sat :
                       currentDayType === 'sun' ? currentMonthly.sun :
                       currentMonthly.pub;

  const handleDeleteShift = (staffName: string, requestId: string, isManual: boolean, wasWorking: boolean) => {
    Alert.alert(
      'シフトの解除・調整',
      `${staffName} さんの当日の予定を削除または変更しますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        { 
          text: '実行する', 
          style: 'destructive', 
          onPress: () => {
            const dateStr = getDateStr(selectedDate);
            const dayType = getDayType(selectedDate);
            
            // Delete existing manual requests
            const existingManualIds = requests
              .filter(r => r.staffName?.trim() === staffName.trim() && r.date === dateStr && !String(r.id).startsWith('auto-'))
              .map(r => r.id);
            
            if (existingManualIds.length > 0) {
              // App.tsxのhandleDeleteRequests経由で同期
              onDeleteRequest(existingManualIds[0]); // ひとつずつ処理
            }
            
            setRequests((prev: any[]) => {
              const filtered = prev.filter(r => !(r.staffName?.trim() === staffName.trim() && r.date === dateStr));
              
              if (wasWorking) {
                if (dayType === 'weekday') {
                  const offRequest = {
                    id: `off-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    staffName: staffName,
                    date: dateStr,
                    type: '公休',
                    status: 'approved',
                    reason: 'シフト調整',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  };
                  return [...filtered, offRequest];
                }
              }
              return filtered;
            });
            Alert.alert('完了', 'シフトを解除・調整しました。');
          }
        }
      ]
    );
  };

  const handleAddStaff = (staffNames: string[]) => {
    const dateStr = getDateStr(selectedDate);
    const newReqs = staffNames.map(name => ({
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      staffName: name,
      date: dateStr,
      type: selectedType,
      status: 'approved',
      reason: '管理者による調整',
      details: { 
        note: '手動割当',
        duration: (selectedType === '時間休' || selectedType === '時間給' || selectedType === '特休' || selectedType === '看護休暇') ? hourlyDuration : undefined
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

  const daysInMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth());
  const firstDayOfMonth = getFirstDayOfMonth(currentDate.getFullYear(), currentDate.getMonth());

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

      const isSelected = day === selectedDate.getDate() && currentDate.getMonth() === selectedDate.getMonth() && currentDate.getFullYear() === selectedDate.getFullYear();
      const isToday = day === new Date().getDate() && 
                      currentDate.getMonth() === new Date().getMonth() && 
                      currentDate.getFullYear() === new Date().getFullYear();
      
      const d = day ? new Date(currentDate.getFullYear(), currentDate.getMonth(), day) : null;
      const dayType = d ? getDayType(d) : 'weekday';
      const monthly = monthlyLimits[monthStr] || { weekday: weekdayLimit, sat: saturdayLimit, sun: sundayLimit, pub: publicHolidayLimit };
      const limit = dayType === 'weekday' ? monthly.weekday : 
                    dayType === 'sat' ? monthly.sat :
                    dayType === 'sun' ? monthly.sun :
                    monthly.pub;

      let dateColor = COLORS.text;
      if (dayType === 'sun' || dayType === 'holiday') dateColor = '#ef4444';
      if (dayType === 'sat') dateColor = '#3b82f6';

      let workingCount = 0;
      let holidayWorkers: any[] = [];
      if (day) {
        const info = getDetailedDayInfo(d!);
        workingCount = info.working.filter(w => !w.isHomeVisit).length;
        if (dayType !== 'weekday') {
          holidayWorkers = info.working.filter(w => !w.isHomeVisit).map(w => w.staff.name);
        }
      }

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
          onPress={() => day && setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))}
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
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}>
            <ChevronLeft color={COLORS.text} size={24} />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <ThemeText style={{ fontSize: 24 }}>{getSeasonalTheme(currentDate.getMonth()).icon}</ThemeText>
            <ThemeText variant="h2">{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</ThemeText>
          </View>
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}>
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
            <ThemeText variant="h2">{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日の詳細</ThemeText>
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
                    <ThemeText variant="caption" bold>{item.staff.name}</ThemeText>
                    <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginLeft: 8 }} numberOfLines={1}>
                      ({item.type}{item.isHomeVisit ? ' / 訪問' : ''})
                      {item.details?.startTime && <ThemeText variant="caption" style={{ color: COLORS.accent, fontWeight: 'bold' }}> {item.details.startTime}-{item.details.endTime}</ThemeText>}
                      {(!item.details?.startTime && item.details?.duration) && <ThemeText variant="caption" style={{ color: COLORS.accent, fontWeight: 'bold' }}> {item.details.duration}h</ThemeText>}
                      {item.status === 'pending' && <ThemeText variant="caption" style={{ color: '#f59e0b', fontWeight: 'bold' }}> [申請中]</ThemeText>}
                    </ThemeText>
                  </View>
                  {(isPrivileged || profile?.name === item.staff.name) && (
                    <TouchableOpacity 
                      onPress={() => handleDeleteShift(item.staff.name, item.requestId, item.isManual, true)}
                      style={[styles.smallActionBtn, { borderColor: '#ef4444', zIndex: 5 }]}
                    >
                      <ThemeText variant="caption" style={{ color: '#ef4444', fontWeight: 'bold' }}>削除</ThemeText>
                    </TouchableOpacity>
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
                    <ThemeText variant="caption" bold style={{ color: COLORS.textSecondary }}>{item.staff.name}</ThemeText>
                    <ThemeText variant="caption" style={{ marginLeft: 8, color: COLORS.textSecondary }} numberOfLines={1}>
                      ({item.type})
                      {item.details?.startTime && <ThemeText variant="caption" style={{ color: COLORS.accent }}> {item.details.startTime}-{item.details.endTime}</ThemeText>}
                      {(!item.details?.startTime && item.details?.duration) && <ThemeText variant="caption" style={{ color: COLORS.accent }}> {item.details.duration}h</ThemeText>}
                      {item.status === 'pending' && <ThemeText variant="caption" style={{ color: '#f59e0b', fontWeight: 'bold' }}> [申請中]</ThemeText>}
                    </ThemeText>
                  </View>
                  {(isPrivileged || profile?.name === item.staff.name) && (
                    <TouchableOpacity 
                      onPress={() => handleDeleteShift(item.staff.name, item.requestId, item.isManual, false)}
                      style={[styles.smallActionBtn, { borderColor: '#ef4444', zIndex: 5 }]}
                    >
                      <ThemeText variant="caption" style={{ color: '#ef4444', fontWeight: 'bold' }}>削除</ThemeText>
                    </TouchableOpacity>
                  )}
                </View>
            )) : (
              <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginTop: 4, marginLeft: 8 }}>休暇者なし</ThemeText>
            )}
          </View>

          <TouchableOpacity 
            style={[styles.finishBtn, { marginTop: 32 }]} 
            onPress={() => {
              Alert.alert('完了', 'シフト調整を確定しました。');
            }}
          >
            <Check size={20} color="white" />
            <ThemeText bold color="white" style={{ marginLeft: 12 }}>決定</ThemeText>
          </TouchableOpacity>
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
                <ThemeText variant="caption">{formatDate(selectedDate)}</ThemeText>
              </View>
              <TouchableOpacity onPress={() => setIsAddStaffModalVisible(false)}>
                <XCircle color={COLORS.textSecondary} size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 400 }}>
              {staffList
                .filter(s => {
                  const mStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
                  const isLongTerm = s.status?.trim() === '長期休暇' || s.placement?.trim() === '長期休暇' || s.position?.trim() === '長期休暇' || s.status?.trim() === '入職前';
                  const isNoHoliday = (getDayType(selectedDate) !== 'weekday') && (s.monthlyNoHoliday?.[mStr] ?? s.noHoliday);
                  const alreadyHasRequest = requests.some(r => r.staffName.trim() === s.name.trim() && r.date === getDateStr(selectedDate) && r.status === 'approved');
                  
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
              {['出勤', '午前休', '午後休', '時間休', '午前振替', '午後振替', '公休', '特休', '年休', '看護休暇'].map(t => (
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

            {(selectedType === '時間休' || selectedType === '時間給' || selectedType === '特休' || selectedType === '看護休暇') && (
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
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
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
});
