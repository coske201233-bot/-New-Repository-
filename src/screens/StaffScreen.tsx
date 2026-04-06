import React, { useState, useMemo, useEffect } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, TextInput, Modal, Alert, SafeAreaView, ActivityIndicator } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { Search, Filter, Calendar, Settings, Plus, X, Trash2, Check, Save, Lock, Unlock } from 'lucide-react-native';
import { normalizeName } from '../utils/staffUtils';
import { getDayType, getDateStr } from '../utils/dateUtils';
import { cloudStorage } from '../utils/cloudStorage';

interface StaffScreenProps {
  staffList: any[];
  setStaffList: (staff: any[] | ((prev: any[]) => any[])) => void;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  currentDate: Date;
  isPrivileged?: boolean;
  setIsAdminAuthenticated?: (auth: boolean) => void;
  adminPassword?: string;
  initialWard?: string;
}

export const StaffScreen: React.FC<StaffScreenProps> = ({
  staffList,
  setStaffList,
  requests,
  setRequests,
  currentDate,
  isPrivileged = false,
  setIsAdminAuthenticated,
  adminPassword
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('すべて');
  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);
  const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [hourlyValue, setHourlyValue] = useState(1.0);
  const [pendingType, setPendingType] = useState('出勤');
  
  // Auth and sync
  const [authInput, setAuthInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);

  // Buffer state for staff editing
  const [editName, setEditName] = useState('');
  const [editProfession, setEditProfession] = useState('');
  const [editPlacement, setEditPlacement] = useState('');

  const categories = ['すべて', '2F', '3F', '4F', '外来', 'フォロー', '兼務'];

  const filteredStaff = useMemo(() => {
    return staffList.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchFilter = activeFilter === 'すべて' || s.placement === activeFilter;
      return matchSearch && matchFilter;
    });
  }, [staffList, searchQuery, activeFilter]);

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const SHIFT_TYPES = ['出勤', '公休', '年休', '特休', '午前休', '午後休', '午前振替', '午後振替', '夏季休暇', '時間休'];

  const monthInfo = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const leadingEmpty = Array.from({ length: firstDay }, (_, i) => ({ day: -i, empty: true }));
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const dateObj = new Date(currentYear, currentMonth, d);
      return { day: d, dateStr: getDateStr(dateObj), type: getDayType(dateObj), isH: ['holiday','sun','sat'].includes(getDayType(dateObj)), empty: false };
    });
    return [...leadingEmpty, ...days];
  }, [currentYear, currentMonth]);

  const requestMap = useMemo(() => {
    const map = new Map<string, Map<string, any>>();
    requests.forEach(r => {
      if (r.status !== 'approved' || !r.date || !r.staffName) return;
      const sT = normalizeName(r.staffName);
      if (!map.has(r.date)) map.set(r.date, new Map());
      map.get(r.date)!.set(sT, r);
    });
    return map;
  }, [requests]);
  
  const staffStats = useMemo(() => {
    const stats = new Map();
    staffList.forEach(s => {
      const sT = normalizeName(s.name);
      const sStats = { weekday: 0, sat: 0, sun: 0, holiday: 0 };
      monthInfo.forEach(d => {
        if (d.empty) return;
        const req = requestMap.get(d.dateStr)?.get(sT);
        const shiftType = req ? (req.type === '時間給' ? '時間休' : req.type) : (d.isH ? '公休' : '出勤');
        const isWork = !['公休', '特休', '年休', '有給', '休暇', '欠勤', '午前休', '午後休', '午前振替', '午後振替', '夏季休暇', '時間休', '時間給'].includes(shiftType);
        if (isWork) {
          const type = (d as any).type;
          if (type === 'weekday') sStats.weekday++;
          else if (type === 'sat') sStats.sat++;
          else if (type === 'sun') sStats.sun++;
          else if (type === 'holiday') sStats.holiday++;
        }
      });
      stats.set(sT, sStats);
    });
    return stats;
  }, [staffList, monthInfo, requestMap]);

  useEffect(() => {
    setSaveStatus(null);
    if (selectedDay !== null && selectedStaff) {
      const dateStr = getDateStr(new Date(currentYear, currentMonth, selectedDay));
      const sT = normalizeName(selectedStaff.name);
      const currentReq = requestMap.get(dateStr)?.get(sT);
      if (currentReq) {
        setPendingType(currentReq.type === '時間給' ? '時間休' : currentReq.type);
        setHourlyValue(currentReq.details?.duration || 1.0);
      } else {
        const isH = monthInfo.find(m => m.day === selectedDay)?.isH;
        setPendingType(isH ? '公休' : '出勤');
        setHourlyValue(1.0);
      }
    }
  }, [selectedDay, selectedStaff]);

  const handleApplyChange = async () => {
    if (selectedDay === null || !selectedStaff) return;
    if (!isPrivileged) {
      Alert.alert('認証エラー', 'パスワードを入力して認証ボタンを押してください。');
      return;
    }

    setIsSaving(true);
    setSaveStatus(null);
    const dateStr = getDateStr(new Date(currentYear, currentMonth, selectedDay));
    const sT = normalizeName(selectedStaff.name);
    const useDuration = pendingType === '時間休' || pendingType === '特休';

    const newReq = {
      id: `man-${Date.now()}`,
      staffName: selectedStaff.name,
      date: dateStr,
      type: pendingType,
      status: 'approved',
      details: useDuration ? { duration: hourlyValue } : undefined,
      createdAt: new Date().toISOString()
    };

    try {
      setRequests((prev: any[]) => {
        const filtered = prev.filter(r => !(r.date === dateStr && normalizeName(r.staffName) === sT));
        return [...filtered, newReq];
      });
      await cloudStorage.upsertRequests([newReq]);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch(e) {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleModalAuth = () => {
    if (authInput === adminPassword) {
      setIsAdminAuthenticated?.(true);
      setAuthInput('');
      Alert.alert('認証完了', '管理者モードが有効になりました。確定ボタンが使用可能です。');
    } else {
      Alert.alert('エラー', 'パスワードが正しくありません。');
    }
  };

  const handleUpdateStaff = () => {
    if (!selectedStaff) return;
    const updated = staffList.map(s => s.id === selectedStaff.id ? { ...s, name: editName, profession: editProfession, placement: editPlacement } : s);
    setStaffList(updated);
    setIsDetailModalVisible(false);
    Alert.alert('更新完了', '職員情報を保存しました。');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ThemeText variant="h1">職員名簿</ThemeText>
        <ThemeText variant="caption" color={COLORS.textSecondary}>職員の統計と管理</ThemeText>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={20} color={COLORS.textSecondary} />
          <TextInput style={styles.searchInput} placeholder="名前を検索..." value={searchQuery} onChangeText={setSearchQuery} />
        </View>
      </View>

      <View style={styles.filterArea}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {categories.map(cat => (
            <TouchableOpacity key={cat} style={[styles.filterChip, activeFilter === cat && styles.filterChipActive]} onPress={() => setActiveFilter(cat)}>
              <ThemeText color={activeFilter === cat ? 'white' : COLORS.text}>{cat}</ThemeText>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        {filteredStaff.map(staff => {
          const stats = staffStats.get(normalizeName(staff.name)) || { weekday: 0, sat: 0, sun: 0, holiday: 0 };
          return (
            <ThemeCard key={staff.id} style={styles.staffCard}>
              <View style={styles.cardTop}>
                <View style={styles.avatar}><ThemeText bold color={COLORS.primary}>{staff.name[0]}</ThemeText></View>
                <TouchableOpacity style={{ flex: 1, marginLeft: 12 }} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}>
                  <ThemeText variant="h2">{staff.name}</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>{staff.profession} | {staff.placement}</ThemeText>
                </TouchableOpacity>
                <View style={styles.actionBtns}>
                  <TouchableOpacity style={[styles.miniBtn, { borderColor: '#38bdf8' }]} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}><Calendar size={18} color="#38bdf8" /></TouchableOpacity>
                  <TouchableOpacity style={[styles.miniBtn, { borderColor: '#eab308' }]} onPress={() => { setSelectedStaff(staff); setEditName(staff.name); setEditProfession(staff.profession); setEditPlacement(staff.placement); setIsDetailModalVisible(true); }}><Settings size={18} color="#eab308" /></TouchableOpacity>
                </View>
              </View>
              <View style={styles.statsGrid}>
                {[{ label: '平', val: stats.weekday }, { label: '土', val: stats.sat }, { label: '日', val: stats.sun }, { label: '祝', val: stats.holiday }].map(item => (
                  <View key={item.label} style={styles.statBox}><ThemeText style={styles.statLabel}>{item.label}</ThemeText><ThemeText bold style={styles.statValue}>{item.val}</ThemeText></View>
                ))}
              </View>
            </ThemeCard>
          );
        })}
      </ScrollView>

      {/* 職員設定モーダル */}
      <Modal visible={isDetailModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: '60%' }]}>
            <View style={styles.modalHeader}>
              <ThemeText variant="h2">職員情報の編集</ThemeText>
              <TouchableOpacity onPress={() => setIsDetailModalVisible(false)}><X size={24} color={COLORS.textSecondary} /></TouchableOpacity>
            </View>
            <ScrollView>
              <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="名前" />
              <TextInput style={styles.input} value={editProfession} onChangeText={setEditProfession} placeholder="職種" />
              <TextInput style={styles.input} value={editPlacement} onChangeText={setEditPlacement} placeholder="配置" />
              <TouchableOpacity style={styles.confirmBtn} onPress={handleUpdateStaff}><ThemeText bold color="white">更新を保存</ThemeText></TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 個人カレンダーモーダル */}
      <Modal visible={isCalendarModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: '90%', maxHeight: 950 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemeText variant="h2" numberOfLines={1}>{selectedStaff?.name} のシフト管理</ThemeText>
                <ThemeText variant="caption" color={COLORS.textSecondary}>{currentMonth + 1}月の勤務割当 (カレンダー)</ThemeText>
              </View>
              <TouchableOpacity onPress={() => setIsCalendarModalVisible(false)} style={styles.closeBtn}><X size={24} color={COLORS.textSecondary} /></TouchableOpacity>
            </View>

            <ScrollView bounces={false} style={{ flex: 1 }}>
              <View style={styles.calendarGrid}>
                <View style={styles.dowHeader}>
                  {['日', '月', '火', '水', '木', '金', '土'].map((dow, idx) => (
                    <ThemeText key={dow} style={[styles.dowText, idx === 0 && {color:'#ef4444'}, idx === 6 && {color:'#38bdf8'}]}>{dow}</ThemeText>
                  ))}
                </View>
                <View style={styles.daysContainer}>
                  {monthInfo.map((d, i) => {
                    if (d.empty) return <View key={i} style={styles.gridDayEmpty} />;
                    const sT = normalizeName(selectedStaff?.name || '');
                    const req = requestMap.get((d as any).dateStr)?.get(sT);
                    const currentType = req ? (req.type === '時間給' ? '時間休' : req.type) : ((d as any).isH ? '公休' : '出勤');
                    const duration = req?.details?.duration;
                    const isSelected = selectedDay === (d as any).day;
                    return (
                      <TouchableOpacity key={i} style={[styles.gridDay, isSelected && styles.gridDaySelected]} onPress={() => setSelectedDay((d as any).day)}>
                        <ThemeText style={[{ fontSize: 13, fontWeight: 'bold' }, i%7===0 || (d as any).type === 'holiday' ? {color:'#ef4444'} : i%7===6 ? {color:'#38bdf8'} : {color:'white'}]}>{(d as any).day}</ThemeText>
                        <View style={[styles.dayBadge, { backgroundColor: currentType === '出勤' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,180,0,0.1)' }]}>
                          <ThemeText numberOfLines={1} style={{ fontSize: 7, color: currentType === '出勤' ? '#10b981' : '#eab308' }}>{currentType}{duration ? ` ${duration}h` : ''}</ThemeText>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {selectedDay !== null && (
                <View style={styles.selectionFooter}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <ThemeText bold variant="h2">{currentMonth + 1}/{selectedDay} の設定</ThemeText>
                    <TouchableOpacity onPress={() => setSelectedDay(null)}><X size={20} color={COLORS.textSecondary} /></TouchableOpacity>
                  </View>
                  
                  {!isPrivileged ? (
                    <View style={styles.authPromptBanner}>
                      <ThemeText bold color="#f87171" style={{ marginBottom: 12 }}>管理者認証をしてください</ThemeText>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TextInput 
                          style={[styles.input, { flex: 1, marginBottom: 0 }]} 
                          placeholder="パスワード" 
                          secureTextEntry 
                          value={authInput}
                          onChangeText={setAuthInput}
                        />
                        <TouchableOpacity style={styles.inlineAuthBtn} onPress={handleModalAuth}>
                          <ThemeText bold color="white">認証</ThemeText>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View>
                      <ThemeText variant="label" style={{ marginBottom: 8 }}>種類を選択</ThemeText>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {SHIFT_TYPES.map(type => (
                            <TouchableOpacity key={type} style={[styles.typeSelectBtn, pendingType === type && styles.typeSelectBtnActive]} onPress={() => setPendingType(type)}>
                              <ThemeText bold color={pendingType === type ? 'white' : COLORS.text}>{type}</ThemeText>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>

                      {(pendingType === '時間休' || pendingType === '特休') && (
                        <View style={styles.hourlyContainer}>
                          <View style={{ flex: 1 }}>
                            <ThemeText bold>{pendingType}の時間設定</ThemeText>
                            <ThemeText variant="caption" color={COLORS.textSecondary}>0.25h刻み</ThemeText>
                          </View>
                          <View style={styles.stepper}>
                            <TouchableOpacity style={styles.stepBtn} onPress={() => setHourlyValue(Math.max(0.25, hourlyValue - 0.25))}><ThemeText bold color="white">−</ThemeText></TouchableOpacity>
                            <ThemeText bold style={{ width: 60, textAlign: 'center' }}>{hourlyValue.toFixed(2)}h</ThemeText>
                            <TouchableOpacity style={styles.stepBtn} onPress={() => setHourlyValue(Math.min(7.75, hourlyValue + 0.25))}><ThemeText bold color="white">+</ThemeText></TouchableOpacity>
                          </View>
                        </View>
                      )}

                      {saveStatus === 'success' && <ThemeText bold color="#10b981" style={{ textAlign: 'center', marginBottom: 8 }}>✅ 保存しました</ThemeText>}
                      {saveStatus === 'error' && <ThemeText bold color="#ef4444" style={{ textAlign: 'center', marginBottom: 8 }}>❌ 保存に失敗しました</ThemeText>}

                      <TouchableOpacity style={[styles.finalApplyBtn, isSaving && { opacity: 0.7 }]} onPress={handleApplyChange} disabled={isSaving}>
                        {isSaving ? <ActivityIndicator color="white" size="small" /> : <><Save size={20} color="white" /><ThemeText bold color="white" style={{ marginLeft: 8 }}>確定する</ThemeText></>}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {isPrivileged && <TouchableOpacity style={styles.fab}><Plus size={30} color="white" /></TouchableOpacity>}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.md, paddingTop: 20 },
  searchContainer: { paddingHorizontal: SPACING.md, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, paddingHorizontal: 16, height: 52 },
  searchInput: { flex: 1, marginLeft: 12, color: 'white', fontSize: 16 },
  filterArea: { marginBottom: 16 },
  filterScroll: { paddingHorizontal: SPACING.md, paddingBottom: 4 },
  filterChip: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.08)', marginRight: 10 },
  filterChipActive: { backgroundColor: '#38bdf8' },
  scrollContent: { padding: SPACING.md, paddingBottom: 100 },
  staffCard: { padding: 16, marginBottom: 16, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(56, 189, 248, 0.1)', justifyContent: 'center', alignItems: 'center' },
  actionBtns: { flexDirection: 'row', gap: 8 },
  miniBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  statsGrid: { flexDirection: 'row', gap: 6, marginTop: 12 },
  statBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 8, alignItems: 'center' },
  statLabel: { fontSize: 9, color: COLORS.textSecondary },
  statValue: { fontSize: 15, color: 'white' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#0f172a', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingBottom: 12 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  calendarGrid: { marginBottom: 16 },
  dowHeader: { flexDirection: 'row', marginBottom: 8 },
  dowText: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 'bold', color: COLORS.textSecondary },
  daysContainer: { flexDirection: 'row', flexWrap: 'wrap' },
  gridDay: { width: '14.28%', height: 65, justifyContent: 'center', alignItems: 'center', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.03)' },
  gridDayEmpty: { width: '14.28%', height: 65 },
  gridDaySelected: { backgroundColor: 'rgba(56, 189, 248, 0.12)', borderColor: '#38bdf8', borderRadius: 8 },
  dayBadge: { marginTop: 4, paddingHorizontal: 2, paddingVertical: 1, borderRadius: 4 },
  selectionFooter: { padding: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, marginBottom: 40, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  authPromptBanner: { backgroundColor: 'rgba(248, 113, 113, 0.1)', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(248, 113, 113, 0.3)' },
  inlineAuthBtn: { backgroundColor: '#38bdf8', borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' },
  typeSelectBtn: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  typeSelectBtnActive: { backgroundColor: '#38bdf8', borderColor: '#38bdf8' },
  hourlyContainer: { marginBottom: 16, flexDirection: 'row', alignItems: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: 4 },
  stepBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(56, 189, 248, 0.3)', justifyContent: 'center', alignItems: 'center' },
  finalApplyBtn: { backgroundColor: '#38bdf8', height: 56, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 10, elevation: 4 },
  input: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, height: 48, paddingHorizontal: 16, color: 'white', marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  confirmBtn: { backgroundColor: '#38bdf8', height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  fab: { position: 'absolute', bottom: 30, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#38bdf8', justifyContent: 'center', alignItems: 'center', elevation: 8 }
});
