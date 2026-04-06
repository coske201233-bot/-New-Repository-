import React, { useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Alert, TextInput, SafeAreaView, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { 
  ChevronLeft, ChevronRight, Calendar, User, 
  Check, X, Clock, MapPin, Briefcase, Trash2, Settings, Shield, Printer
} from 'lucide-react-native';
import { getMonthInfo, normalizeName } from '../utils/dateUtils';
import { cloudStorage } from '../utils/cloudStorage';

interface StaffScreenProps {
  staffList: any[];
  setStaffList: (staff: any[] | ((prev: any[]) => any[])) => void;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  profile: any;
  isAdminAuthenticated: boolean;
  initialWard?: string;
}

interface MonthDay {
  day: number;
  dateStr: string;
  isH?: boolean;
  empty: boolean;
}

export const StaffScreen: React.FC<StaffScreenProps> = ({
  staffList = [], setStaffList, requests = [], setRequests, profile, isAdminAuthenticated, initialWard
}) => {
  const [selectedWard, setSelectedWard] = useState(initialWard || '全部署');
  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);
  const [activeDate, setActiveDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState('日勤');
  const [isSaving, setIsSaving] = useState(false);

  const monthInfo = useMemo(() => (getMonthInfo(activeDate.getFullYear(), activeDate.getMonth()) || []) as MonthDay[], [activeDate]);
  const wards = ['全部署', '外来', '２F', '包括', '４F', '排尿', '兼務', 'フォロー', '管理', '事務', '訪問リハ'];
  
  const filteredStaff = useMemo(() => {
    if (!Array.isArray(staffList)) return [];
    return staffList.filter(s => s && (selectedWard === '全部署' || s.placement === selectedWard));
  }, [staffList, selectedWard]);

  const normalize = (s: string) => normalizeName(s || '');

  const requestMap = useMemo(() => {
    const map = new Map<string, Map<string, any>>();
    if (!Array.isArray(requests)) return map;
    requests.forEach(r => {
      if (!r || !r.date) return;
      if (!map.has(r.date)) map.set(r.date, new Map());
      map.get(r.date)?.set(normalize(r.staffName || ''), r);
    });
    return map;
  }, [requests]);

  const handleDayPress = (d: MonthDay) => {
    if (!d || d.empty) return;
    setSelectedDay(d.dateStr);
    const sT = normalize(selectedStaff?.name || '');
    const existing = requests.find(r => 
      r && (String(r.staffId) === selectedStaff?.id || normalize(r.staffName) === sT) && 
      r.date === d.dateStr
    );
    setSelectedType(existing ? existing.type : '日勤');
  };

  const handleConfirmShift = async () => {
    if (!selectedDay || !selectedStaff || isSaving) return;
    setIsSaving(true);
    try {
      const type = selectedType;
      const newReq = {
        id: `m-${selectedStaff.id}-${selectedDay}`,
        staffId: selectedStaff.id,
        staffName: selectedStaff.name,
        date: selectedDay,
        type: type,
        status: 'approved',
        createdAt: new Date().toISOString(),
        isShift: true
      };
      const sT = normalize(selectedStaff.name);
      const updated = requests.filter(r => r && !( (String(r.staffId) === selectedStaff.id || normalize(r.staffName) === sT) && r.date === selectedDay ));
      const final = [...updated, newReq];
      setRequests(final);
      await cloudStorage.upsertRequests([newReq]);
      Alert.alert('完了', 'シフトを確定しました。');
    } catch (e) {
      Alert.alert('エラー', '失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = () => {
    if (Platform.OS !== 'web' || !selectedStaff) return;
    const year = activeDate.getFullYear();
    const month = activeDate.getMonth() + 1;
    const sT = normalize(selectedStaff.name);
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    
    let rowsHtml = '';
    monthInfo.forEach((d: MonthDay) => {
      if (d.empty) return;
      const r = requestMap.get(d.dateStr)?.get(sT);
      const shiftType = r ? r.type : '-';
      const dayIdx = new Date(d.dateStr).getDay();
      const style = (d.isH || dayIdx === 0) ? 'color: #ef4444;' : '';
      rowsHtml += `
        <tr>
          <td style="${style} text-align: center;">${d.day}</td>
          <td style="${style} text-align: center;">${dayNames[dayIdx]}</td>
          <td style="font-weight: bold; text-align: center; color: ${shiftType === '公休' ? '#ef4444' : '#1e293b'}">${shiftType}</td>
          <td></td>
        </tr>
      `;
    });

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>${selectedStaff.name} - ${year}年${month}月カレンダー</title>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #1e293b; }
            .header { border-bottom: 2px solid #38bdf8; padding-bottom: 10px; margin-bottom: 30px; }
            h1 { margin: 0; font-size: 24px; }
            .meta { font-size: 14px; color: #64748b; margin-top: 5px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
            th { background-color: #f8fafc; font-size: 14px; }
            @media print {
              body { padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>勤務予定表（${year}年${month}月）</h1>
            <div class="meta">
              氏名: <strong>${selectedStaff.name}</strong> 
              (${selectedStaff.profession} | ${selectedStaff.placement}) 
              ${selectedStaff.position ? ` [${selectedStaff.position}]` : ''}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 60px;">日</th>
                <th style="width: 60px;">曜</th>
                <th>シフト</th>
                <th>備考</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(() => { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const renderCalendar = () => {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return (
      <View style={styles.calendarGrid}>
        {days.map(d => <ThemeText key={d} variant="caption" color={COLORS.textSecondary} style={styles.calendarHeaderCase}>{d}</ThemeText>)}
        {monthInfo.map((d: MonthDay, i: number) => {
          if (!d || d.empty) return <View key={`empty-${i}`} style={styles.calendarDay} />;
          const isSelected = selectedDay === d.dateStr;
          const isToday = d.dateStr === new Date().toISOString().split('T')[0];
          const isHoliday = d.isH;
          const sT = normalize(selectedStaff?.name || '');
          const req = requestMap.get(d.dateStr)?.get(sT);
          return (
            <TouchableOpacity key={d.dateStr} style={[styles.calendarDay, isSelected && styles.calendarDaySelected, isToday && styles.calendarDayToday]} onPress={() => handleDayPress(d)}>
              <ThemeText bold={isSelected} color={isHoliday ? '#ef4444' : 'white'} style={{ fontSize: 13 }}>{d.day}</ThemeText>
              {req && <View style={[styles.typeDot, { backgroundColor: req.type === '公休' ? '#ef4444' : '#38bdf8' }]} />}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const calculateStats = (staff: any) => {
    if (!staff) return { workDays: 0, holidayWorkDays: 0, leaveHours: '0.00' };
    const sName = normalize(staff.name);
    const sId = staff.id;
    const staffReqs = requests.filter(r => r && (String(r.staffId) === sId || normalize(r.staffName) === sName) && r.date.startsWith(activeDate.toISOString().slice(0, 7)));
    let workDays = 0, holidayWorkDays = 0, leaveHours = 0;
    staffReqs.forEach(r => {
      const isWeekend = (d: string) => { const date = new Date(d); const dayIdx = date.getDay(); return dayIdx === 0 || dayIdx === 6; };
      const isPub = (monthInfo.find(m => m.dateStr === r.date))?.isH;
      if (['日勤', '夜勤', '早番', '遅番'].includes(r.type)) {
        if (isWeekend(r.date) || isPub) holidayWorkDays++; else workDays++;
      } else if (['年休', '特休'].includes(r.type)) {
        leaveHours += 7.75;
      } else if (r.type === '時間休') {
        leaveHours += parseFloat(r.hours || '1');
      }
    });
    return { workDays, holidayWorkDays, leaveHours: leaveHours.toFixed(2) };
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ThemeText variant="h1">職員名簿</ThemeText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wardScroll}>
          {wards.map(w => (
            <TouchableOpacity key={w} style={[styles.wardTab, selectedWard === w && styles.wardTabActive]} onPress={() => setSelectedWard(w)}>
              <ThemeText bold={selectedWard === w} color={selectedWard === w ? 'white' : COLORS.textSecondary}>{w}</ThemeText>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: 100 }}>
        <View style={styles.staffGrid}>
          {filteredStaff.map(staff => {
            if (!staff) return null;
            const stats = calculateStats(staff);
            const isLongLeave = staff.status === '長期休暇';
            return (
              <ThemeCard key={staff.id} style={[styles.staffCard, isLongLeave && { opacity: 0.6 }]}>
                <View style={styles.cardHeader}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                      <ThemeText bold variant="h2" style={{ marginRight: 8 }}>{staff.name}</ThemeText>
                      {staff.position ? (
                        <View style={styles.badge}><ThemeText style={styles.badgeText}>{staff.position}</ThemeText></View>
                      ) : null}
                      {isLongLeave && (
                        <View style={[styles.badge, { backgroundColor: '#ef4444' }]}><ThemeText style={styles.badgeText}>長期休暇</ThemeText></View>
                      )}
                      {staff.status === '時短勤務' && (
                        <View style={[styles.badge, { backgroundColor: '#eab308' }]}><ThemeText style={[styles.badgeText, {color:'black'}]}>時短</ThemeText></View>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', marginTop: 4, gap: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Briefcase size={12} color={COLORS.textSecondary} /><ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 4 }}>{staff.profession || ''}</ThemeText></View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}><MapPin size={12} color={COLORS.textSecondary} /><ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 4 }}>{staff.placement || ''}</ThemeText></View>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.miniBtn} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}>
                    <Calendar size={18} color="#38bdf8" />
                  </TouchableOpacity>
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

      {/* 個別カレンダーモーダル */}
      <Modal visible={isCalendarModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.calendarModal}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemeText variant="h2">{selectedStaff?.name || ''}</ThemeText>
                <ThemeText variant="caption" color={COLORS.textSecondary}>{activeDate.getFullYear()}年 {activeDate.getMonth() + 1}月</ThemeText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                {Platform.OS === 'web' && (
                  <TouchableOpacity onPress={handlePrint} style={styles.iconBtn}><Printer size={22} color="#38bdf8" /></TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setIsCalendarModalVisible(false)}><X size={24} color={COLORS.textSecondary} /></TouchableOpacity>
              </View>
            </View>
            <View style={styles.calendarNav}>
              <TouchableOpacity onPress={() => setActiveDate(new Date(activeDate.getFullYear(), activeDate.getMonth() - 1, 1))}><ChevronLeft color="white" /></TouchableOpacity>
              <ThemeText bold>{activeDate.getMonth() + 1}月</ThemeText>
              <TouchableOpacity onPress={() => setActiveDate(new Date(activeDate.getFullYear(), activeDate.getMonth() + 1, 1))}><ChevronRight color="white" /></TouchableOpacity>
            </View>
            {renderCalendar()}
            {selectedDay ? (
              <View style={styles.editorSection}>
                <ThemeText bold style={{ marginBottom: 12 }}>{selectedDay} のシフト確定</ThemeText>
                <View style={styles.typeGrid}>
                  {['日勤', '公休', '夜勤', '早番', '遅番'].map(type => (
                    <TouchableOpacity key={type} style={[styles.typeBtn, selectedType === type && styles.typeBtnActive]} onPress={() => setSelectedType(type)}>
                      <ThemeText bold={selectedType === type} color={selectedType === type ? 'white' : COLORS.textSecondary}>{type}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>
                {isAdminAuthenticated && (
                  <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmShift} disabled={isSaving}>
                    {isSaving ? <ActivityIndicator color="white" /> : <ThemeText bold color="white">確定</ThemeText>}
                  </TouchableOpacity>
                )}
              </View>
            ) : <View style={styles.placeholderSection}><ThemeText color={COLORS.textSecondary}>日付をタップ</ThemeText></View>}
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
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
  calendarDay: { width: '14.2%', height: 45, justifyContent: 'center', alignItems: 'center', borderRadius: 8, marginBottom: 4 },
  calendarDaySelected: { backgroundColor: '#38bdf8' },
  calendarDayToday: { borderWidth: 1, borderColor: '#38bdf8' },
  typeDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  editorSection: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 20 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  typeBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  typeBtnActive: { backgroundColor: '#38bdf8' },
  confirmBtn: { height: 56, borderRadius: 16, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
  placeholderSection: { height: 100, justifyContent: 'center', alignItems: 'center' }
});
