import React, { useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator, Platform, Switch, SafeAreaView } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { 
  ChevronLeft, ChevronRight, Settings, Users, 
  Database, RefreshCw, LogOut, Shield, Info,
  AlertCircle, CheckCircle2,
  X, UserPlus, Lock, Calendar
} from 'lucide-react-native';
import { getDayType, getDateStr, isHoliday, getMonthDayCounts } from '../utils/dateUtils';
import { normalizeName, sortStaffByName } from '../utils/staffUtils';
import { cloudStorage } from '../utils/cloudStorage';

const JAPAN_HOLIDAYS_SET = new Set([
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
  '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
  '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
  '2026-10-12', '2026-11-03', '2026-11-23',
  // --- 2027年 ---
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
  '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19',
  '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23'
]);

const isWorkingShift = (type: string) => {
  const leaveTypes = ['年休', '有給休暇', '時間休', '時間給', '看護休暇', '振替', '夏季休暇', '午前休', '午後休', '特休', '休暇', '欠勤', '長期休暇', '全休', '午前振替', '午後振替'];
  return !leaveTypes.includes(type);
};

const PLACEMENTS = ['2F', '3F', '4F', '外来', 'フォロー', '兼務', '包括', '排尿支援', '訪問', '管理', '助手'];
const PROFESSIONS = ['PT', 'OT', 'ST', '助手', 'その他'];
const POSITIONS = ['科長', '係長', '主査', '主任', '主事', '会計年度'];
const STATUSES = ['常勤', '時短勤務', '長期休暇', '入職前'];
const ROLES = ['一般職員', 'シフト管理者', '開発者'];

const ChipSelect = ({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) => (
  <View style={{ marginBottom: 12 }}>
    <ThemeText variant="caption" style={{ color: '#94a3b8', marginBottom: 6 }}>{label}</ThemeText>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {options.map(o => (
          <TouchableOpacity
            key={o}
            onPress={() => onChange(o)}
            style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: value === o ? '#38bdf8' : 'rgba(255,255,255,0.15)', backgroundColor: value === o ? 'rgba(56,189,248,0.15)' : 'transparent' }}
          >
            <ThemeText variant="caption" style={{ color: value === o ? '#38bdf8' : '#94a3b8' }}>{o}</ThemeText>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  </View>
);

const StaffCellModal = ({ cellSelection, onClose, onSave, onAdd, onDelete }: {
  cellSelection: any;
  onClose: () => void;
  onSave: (staff: any) => void;
  onAdd: (staff: any) => void;
  onDelete: (id: any) => void;
}) => {
  const isNew = cellSelection.type === 'staffAdd';
  const initial = isNew
    ? { name: '', placement: '2F', position: '主任', status: '常勤', profession: 'PT', role: '一般職員', isApproved: true, noHoliday: false }
    : { ...cellSelection.staff };
  const [form, setForm] = React.useState(initial);
  const set = (k: string) => (v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <Modal visible transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' }}>
        <ScrollView style={{ backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <ThemeText variant="h2">{isNew ? '職員を追加' : '職員を編集'}</ThemeText>
            <TouchableOpacity onPress={onClose}>
              <X size={24} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <ThemeText variant="caption" style={{ color: '#94a3b8', marginBottom: 6 }}>氏名</ThemeText>
          <TextInput
            value={form.name}
            onChangeText={set('name')}
            placeholder="氏名を入力"
            placeholderTextColor="#475569"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, height: 48, paddingHorizontal: 16, color: 'white', marginBottom: 16, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}
          />

          <ChipSelect label="配属" value={form.placement} options={PLACEMENTS} onChange={set('placement')} />
          <ChipSelect label="職種" value={form.profession} options={PROFESSIONS} onChange={set('profession')} />
          <ChipSelect label="職位" value={form.position} options={POSITIONS} onChange={set('position')} />
          <ChipSelect label="雇用形態" value={form.status} options={STATUSES} onChange={set('status')} />
          <ChipSelect label="ロール" value={form.role} options={ROLES} onChange={set('role')} />

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
            <ThemeText variant="caption" style={{ color: '#94a3b8', flex: 1 }}>休日出勤なし</ThemeText>
            <Switch value={!!form.noHoliday} onValueChange={set('noHoliday')} />
          </View>

          {!isNew && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
              <ThemeText variant="caption" style={{ color: '#94a3b8', flex: 1 }}>承認済み</ThemeText>
              <Switch value={!!form.isApproved} onValueChange={set('isApproved')} />
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 40 }}>
            {!isNew && (
              <TouchableOpacity
                onPress={() => onDelete(form.id)}
                style={{ flex: 1, height: 52, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#ef4444' }}
              >
                <ThemeText bold style={{ color: '#ef4444' }}>削除</ThemeText>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => isNew ? onAdd(form) : onSave({ ...form, updatedAt: new Date().toISOString() })}
              style={{ flex: 2, height: 52, borderRadius: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: '#38bdf8' }}
            >
              <ThemeText bold style={{ color: 'white' }}>{isNew ? '追加する' : '保存する'}</ThemeText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

interface AdminScreenProps {
  staffList: any[];
  setStaffList: (staff: any[] | ((prev: any[]) => any[])) => void;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  onDeleteRequest: (id: string) => void;
  onOpenRequests: () => void;
  onShareApp: () => void;
  onLogout: () => void;
  weekdayLimit: number;
  holidayLimit: number;
  saturdayLimit: number;
  sundayLimit: number;
  publicHolidayLimit: number;
  monthlyLimits: Record<string, { weekday: number, sat: number, sun: number, pub: number }>;
  updateLimits: (type: any, val: number, monthStr?: string) => void;
  adminPassword?: string;
  updatePassword?: (pass: string) => void;
  profile: any;
  setProfile: (p: any) => void;
  isAdminAuthenticated: boolean;
  setIsAdminAuthenticated: (val: boolean) => void;
  staffViewMode?: boolean;
  setStaffViewMode?: (val: boolean) => void;
  currentDate: Date;
  setCurrentDate: (d: Date) => void;
}

export const AdminScreen: React.FC<AdminScreenProps> = ({
  staffList, setStaffList, requests, setRequests, onDeleteRequest,
  onOpenRequests, onShareApp, onLogout,
  weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit,
  monthlyLimits, updateLimits,
  adminPassword, updatePassword,
  profile, setProfile,
  isAdminAuthenticated, setIsAdminAuthenticated,
  staffViewMode, setStaffViewMode,
  currentDate, setCurrentDate
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'staff' | 'settings'>('dashboard');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Local admin auth
  const [isMyPassModalVisible, setIsMyPassModalVisible] = useState(false);
  const [myPassInput, setMyPassInput] = useState('');
  
  const [activeLimitModal, setActiveLimitModal] = useState<any>(null);
  const [cellSelection, setCellSelection] = useState<any>(null);

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

  // Optimization: Index requests to avoid O(N^2) scans in the grid
  const requestMap = useMemo(() => {
    const map = new Map<string, Map<string, any>>();
    requests.forEach((r: any) => {
      if (r.status !== 'approved' || !r.date || !r.staffName) return;
      const sT = normalizeName(r.staffName);
      if (!map.has(r.date)) map.set(r.date, new Map<string, any>());
      map.get(r.date)!.set(sT, r);
    });
    return map;
  }, [requests]);

  // Computed: Pending approval staff
  const pendingStaff = useMemo(() => staffList.filter((s:any) => s.isApproved === false), [staffList]);

  // Pre-calculate month day data at top level (cannot use hooks inside renderDashboard)
  const monthDaysData = useMemo(() => {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const dateObj = new Date(currentYear, currentMonth, d);
      const dateStr = getDateStr(dateObj);
      const type = getDayType(dateObj);
      const isH = type === 'holiday' || type === 'sun' || type === 'sat';
      return { day: d, dateObj, dateStr, type, isH };
    });
  }, [currentYear, currentMonth]);


  const openStaffEdit = (staff: any) => {
    setCellSelection({ type: 'staffEdit', staff });
  };

  const handleUpdateStaff = async (updatedStaff: any) => {
    setStaffList((prev: any[]) => prev.map(s => s.id === updatedStaff.id ? updatedStaff : s));
    try {
      await cloudStorage.upsertStaff([updatedStaff]);
    } catch (err) {
      console.error(err);
      Alert.alert('エラー', 'サーバーへの保存に失敗しました');
    }
  };

  const handleApproveStaff = async (staff: any) => {
    const approvedStaff = { ...staff, isApproved: true };
    handleUpdateStaff(approvedStaff);
  };

  const handleAutoAssign = async () => {
    if (isGenerating) return;
    
    const executeAuto = async () => {
      setIsGenerating(true);
      try {
        const response = await fetch('/api/ai-shift', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            staffList: staffList.filter(s => s.isApproved !== false && s.status !== '入職前'),
            requests: requests.filter(r => r.status === 'approved'),
            limits: monthlyLimits[currentMonthStr] || { weekday: weekdayLimit, saturday: saturdayLimit, sunday: sundayLimit, publicHoliday: publicHolidayLimit },
            month: currentMonth,
            year: currentYear
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.details || errorData.error || `エラー (${response.status})`);
        }
        
        const data = await response.json();
        if (data.newRequests) {
          const newShifts = data.newRequests.map((r: any, idx: number) => ({
            ...r,
            id: `auto-${Date.now()}-${idx}`,
            status: 'approved',
            createdAt: new Date().toISOString()
          }));

          setRequests((prev: any[]) => {
            const prefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-`;
            // Remove previous automated shifts for this month
            const otherShifts = prev.filter(r => !(r.date?.startsWith(prefix) && String(r.id || '').startsWith('auto-')));
            return [...otherShifts, ...newShifts];
          });

          await cloudStorage.upsertRequests(newShifts);
          Alert.alert('完了', `${newShifts.length}件のシフトを生成・保存しました`);
        } else {
          Alert.alert('通知', '割当を作成できませんでした。条件を見直してください。');
        }
      } catch (err: any) {
        console.error(err);
        Alert.alert('エラー', `自動割当中にエラーが発生しました: ${err.message}`);
      } finally {
        setIsGenerating(false);
      }
    };

    Alert.alert('確認', `${currentMonth+1}月のシフトを自動生成しますか？既存の自動割当分は上書きされます。`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '開始', onPress: executeAuto }
    ]);
  };

  const handleForceSync = async () => {
    setIsSyncing(true);
    try {
      const remoteStaff = await cloudStorage.fetchStaff();
      const remoteRequests = await cloudStorage.fetchRequests();
      if (remoteStaff) setStaffList(sortStaffByName(remoteStaff));
      if (remoteRequests) setRequests(remoteRequests);
      Alert.alert('完了', '最新のデータを取得・同期しました');
    } catch (err) {
      Alert.alert('同期失敗', 'サーバーとの同期に失敗しました');
    } finally {
      setIsSyncing(false);
    }
  };

  const renderDashboard = () => {
    // monthDaysData is computed at component top level (hooks cannot be called here)

    const currentMonthLimits = (monthlyLimits && typeof monthlyLimits === 'object' && monthlyLimits[currentMonthStr]) ? monthlyLimits[currentMonthStr] : { 
      weekday: weekdayLimit || 0, 
      sat: saturdayLimit || 0, 
      sun: sundayLimit || 0, 
      pub: publicHolidayLimit || 0 
    };

    const dashboardLimits = [
      { label: '平日', key: 'weekday', val: currentMonthLimits.weekday ?? weekdayLimit },
      { label: '土曜', key: 'saturday', val: currentMonthLimits.sat ?? saturdayLimit },
      { label: '日曜', key: 'sunday', val: currentMonthLimits.sun ?? sundayLimit },
      { label: '祝日', key: 'publicHoliday', val: currentMonthLimits.pub ?? publicHolidayLimit }
    ];

    return (
      <ScrollView style={styles.scroll}>
        <View style={styles.dashboardHeader}>
          <ThemeText variant="h1">管理ダッシュボード</ThemeText>
          <View style={styles.headerBtns}>
            <TouchableOpacity style={styles.iconBtn} onPress={handleForceSync} disabled={isSyncing}>
              {isSyncing ? <ActivityIndicator size={20} color="white" /> : <RefreshCw size={20} color="white" />}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.gridContainer}>
          <ThemeCard style={styles.limitCard}>
            <ThemeText variant="label" color={COLORS.textSecondary}>現在の稼働基準（{currentMonth + 1}月）</ThemeText>
            <View style={styles.limitGrid}>
              {dashboardLimits.map(lim => (
                <TouchableOpacity key={lim.key} style={styles.limitItem} onPress={() => setActiveLimitModal(lim)}>
                  <ThemeText variant="caption">{lim.label}</ThemeText>
                  <ThemeText variant="h2" color={COLORS.primary} bold>{lim.val}名</ThemeText>
                </TouchableOpacity>
              ))}
            </View>
          </ThemeCard>

          <ThemeCard style={styles.monthCard}>
            <TouchableOpacity onPress={() => setCurrentDate(new Date(currentYear, currentMonth - 1, 1))}><ChevronLeft color="white" /></TouchableOpacity>
            <ThemeText bold variant="h2">{currentMonth + 1}月</ThemeText>
            <TouchableOpacity onPress={() => setCurrentDate(new Date(currentYear, currentMonth + 1, 1))}><ChevronRight color="white" /></TouchableOpacity>
          </ThemeCard>
        </View>

        {pendingStaff.length > 0 && (
          <ThemeCard style={[styles.alertCard, { borderColor: COLORS.accent }]}>
            <View style={styles.alertRow}>
              <AlertCircle color={COLORS.accent} size={20} />
              <ThemeText bold style={{ marginLeft: 8, color: COLORS.accent }}>{pendingStaff.length}名の未承認スタッフがいます</ThemeText>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
              {pendingStaff.map((s:any) => (
                <TouchableOpacity key={s.id} style={styles.pendingBadge} onPress={() => openStaffEdit(s)}>
                  <ThemeText variant="caption" bold>{s.name}</ThemeText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </ThemeCard>
        )}

        <View style={styles.actionGrid}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleAutoAssign} disabled={isGenerating}>
            {isGenerating ? <ActivityIndicator color="white" /> : <Database size={24} color="white" />}
            <ThemeText bold color="white" style={{ marginTop: 8 }}>AI自動割当</ThemeText>
          </TouchableOpacity>
          
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#8b5cf6' }]} onPress={onOpenRequests}>
            <Info size={24} color="white" />
            <ThemeText bold color="white" style={{ marginTop: 8 }}>申請一覧</ThemeText>
          </TouchableOpacity>
        </View>

        <ThemeCard style={styles.fullGridCard}>
           <ThemeText variant="h2" bold style={{ marginBottom: 12 }}>シフト全体図 ({currentMonth + 1}月)</ThemeText>
           <ScrollView horizontal>
             <View>
               <View style={styles.tableRow}>
                 <View style={[styles.staffCol, styles.tableHeader]}><ThemeText bold variant="caption">氏名</ThemeText></View>
                 {monthDaysData.map(d => (
                   <View key={d.day} style={[styles.dayCol, styles.tableHeader, d.isH && { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
                     <ThemeText variant="caption" style={{ fontSize: 9 }}>{d.day}</ThemeText>
                   </View>
                 ))}
               </View>
               {staffList.filter(s => s.isApproved !== false && s.status !== '入職前')
                .map(s => {
                  const sT = normalizeName(s.name);
                  return (
                    <View key={s.id} style={styles.tableRow}>
                      <View style={styles.staffCol}>
                        <ThemeText variant="caption" numberOfLines={1}>{s.name}</ThemeText>
                      </View>
                      {monthDaysData.map(d => {
                        const req = requestMap.get(d.dateStr)?.get(sT);
                        const isWork = req ? isWorkingShift(req.type || '') : (d.type === 'weekday');
                        
                        let t = ' '; 
                        let c = COLORS.textSecondary;
                        
                        if (req) {
                          const rType = req.type || '不明';
                          if (rType === '出勤') { t = '出'; c = '#22c55e'; }
                          else { 
                            t = (typeof rType === 'string' && rType.length > 0) ? rType.substring(0,1) : '？'; 
                            c = COLORS.accent; 
                          }
                        } else {
                          if (isWork) { t = '・'; c = 'rgba(255,255,255,0.1)'; }
                          else { t = '公'; c = '#ef4444'; }
                        }
                        
                        return (
                          <View key={d.day} style={styles.dayCol}>
                            <ThemeText style={{ fontSize: 10, color: c, fontWeight: req ? 'bold' : 'normal' }}>{t}</ThemeText>
                          </View>
                        );
                      })}
                    </View>
                  );
                })
               }
             </View>
           </ScrollView>
        </ThemeCard>
        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const renderStaff = () => {
    const list = sortStaffByName(staffList);
    return (
      <ScrollView style={styles.scroll}>
        <View style={styles.dashboardHeader}>
          <ThemeText variant="h1">職員管理 ({list.length}名)</ThemeText>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setCellSelection({ type: 'staffAdd' })}>
            <UserPlus size={20} color="white" />
          </TouchableOpacity>
        </View>
        <View style={{ padding: SPACING.md }}>
          {list.map((s:any) => (
            <ThemeCard key={s.id} style={styles.staffCard}>
              <TouchableOpacity style={styles.staffMain} onPress={() => openStaffEdit(s)}>
                <View style={[styles.statusIndicator, { backgroundColor: s.isApproved ? '#10b981' : COLORS.accent }]} />
                <View style={{ flex: 1 }}>
                  <ThemeText bold variant="h2">{s.name}</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>{s.placement} / {s.profession}</ThemeText>
                </View>
                {!s.isApproved && (
                  <TouchableOpacity style={styles.approveBtn} onPress={() => handleApproveStaff(s)}>
                    <CheckCircle2 color="white" size={16} />
                    <ThemeText variant="caption" bold color="white" style={{ marginLeft: 4 }}>承認</ThemeText>
                  </TouchableOpacity>
                )}
                <ChevronRight size={20} color={COLORS.border} />
              </TouchableOpacity>
            </ThemeCard>
          ))}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const renderSettings = () => (
    <ScrollView style={styles.scroll}>
      <View style={styles.dashboardHeader}>
        <ThemeText variant="h1">管理設定</ThemeText>
      </View>
      <View style={{ padding: SPACING.md, gap: SPACING.md }}>
        <ThemeCard style={styles.settingsGroup}>
          <ThemeText variant="label" bold style={{ marginBottom: 12 }}>セキュリティ</ThemeText>
          <TouchableOpacity style={styles.settingsItem} onPress={() => setIsMyPassModalVisible(true)}>
            <Lock size={18} color={COLORS.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <ThemeText bold>管理者パスワード</ThemeText>
              <ThemeText variant="caption" color={COLORS.textSecondary}>管理者画面に入るための共通パスワード</ThemeText>
            </View>
            <ChevronRight size={18} color={COLORS.border} />
          </TouchableOpacity>
        </ThemeCard>

        <ThemeCard style={styles.settingsGroup}>
          <ThemeText variant="label" bold style={{ marginBottom: 12 }}>アプリケーション</ThemeText>
          <TouchableOpacity style={styles.settingsItem} onPress={onShareApp}>
            <Settings size={18} color={COLORS.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <ThemeText bold>アプリを共有</ThemeText>
              <ThemeText variant="caption" color={COLORS.textSecondary}>職員へ配布用のQRコードを表示</ThemeText>
            </View>
            <ChevronRight size={18} color={COLORS.border} />
          </TouchableOpacity>
          {setStaffViewMode && (
             <TouchableOpacity style={styles.settingsItem} onPress={() => setStaffViewMode(!staffViewMode)}>
               {staffViewMode ? <Shield size={18} color="#ef4444" /> : <Users size={18} color={COLORS.primary} />}
               <View style={{ flex: 1, marginLeft: 12 }}>
                 <ThemeText bold>{staffViewMode ? '管理者モードへ戻る' : '職員モードで表示'}</ThemeText>
                 <ThemeText variant="caption" color={COLORS.textSecondary}>{staffViewMode ? '管理機能を再有効化します' : '職員が見る画面と同じ表示を確認します'}</ThemeText>
               </View>
               <Switch value={staffViewMode} onValueChange={setStaffViewMode} />
             </TouchableOpacity>
          )}
        </ThemeCard>

        <TouchableOpacity 
          style={[styles.actionBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#ef4444' }]} 
          onPress={onLogout}
        >
          <LogOut size={18} color="#ef4444" />
          <ThemeText bold color="#ef4444" style={{ marginLeft: 8 }}>ログアウト</ThemeText>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabHeader}>
        {[
          { id: 'dashboard', label: '稼働', icon: Calendar },
          { id: 'staff', label: '職員', icon: Users },
          { id: 'settings', label: '設定', icon: Settings }
        ].map(t => (
          <TouchableOpacity 
            key={t.id} 
            style={[styles.tabItem, activeTab === t.id && styles.tabItemActive]}
            onPress={() => setActiveTab(t.id as any)}
          >
            <t.icon size={20} color={activeTab === t.id ? 'white' : COLORS.textSecondary} />
            <ThemeText variant="caption" bold={activeTab === t.id} color={activeTab === t.id ? 'white' : COLORS.textSecondary} style={{ marginTop: 4 }}>{t.label}</ThemeText>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'dashboard' ? renderDashboard() : 
       activeTab === 'staff' ? renderStaff() : renderSettings()}

      {/* Limit Update Modal */}
      {activeLimitModal && (
        <Modal transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ThemeText variant="h2" style={{ marginBottom: 4 }}>稼働基準の変更</ThemeText>
              <ThemeText variant="caption" style={{ marginBottom: 20 }}>{activeLimitModal.label}の目標稼働人数を変更します</ThemeText>
              
              <View style={styles.counterRow}>
                <TouchableOpacity style={styles.counterBtn} onPress={() => setActiveLimitModal({...activeLimitModal, val: Math.max(0, activeLimitModal.val - 1)})}>
                  <ThemeText variant="h2">−</ThemeText>
                </TouchableOpacity>
                <ThemeText variant="h1" style={{ width: 60, textAlign: 'center' }}>{activeLimitModal.val}</ThemeText>
                <TouchableOpacity style={styles.counterBtn} onPress={() => setActiveLimitModal({...activeLimitModal, val: activeLimitModal.val + 1})}>
                  <ThemeText variant="h2">+</ThemeText>
                </TouchableOpacity>
              </View>

              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setActiveLimitModal(null)}>
                  <ThemeText bold>キャンセル</ThemeText>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={() => {
                  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
                  updateLimits(activeLimitModal.key, activeLimitModal.val, currentMonthStr);
                  setActiveLimitModal(null);
                }}>
                  <ThemeText bold color="white">保存する</ThemeText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Admin Password Modal */}
      <Modal visible={isMyPassModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ThemeText variant="h2" style={{ marginBottom: 4 }}>パスワード設定</ThemeText>
            <ThemeText variant="caption" style={{ marginBottom: 20 }}>新しい管理者共通パスワードを入力してください</ThemeText>
            <TextInput
              style={styles.input}
              value={myPassInput}
              onChangeText={setMyPassInput}
              secureTextEntry
              placeholder="新しいパスワード"
              placeholderTextColor="#666"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsMyPassModalVisible(false)}>
                <ThemeText bold>キャンセル</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={() => {
                if (updatePassword) updatePassword(myPassInput);
                setIsMyPassModalVisible(false);
                Alert.alert('完了', 'パスワードを更新しました');
              }}>
                <ThemeText bold color="white">更新する</ThemeText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Staff Edit / Add Modal */}
      {cellSelection && (
        <StaffCellModal
          cellSelection={cellSelection}
          onClose={() => setCellSelection(null)}
          onSave={handleUpdateStaff}
          onAdd={async (newStaff: any) => {
            const staffEntry = { ...newStaff, id: Date.now(), updatedAt: new Date().toISOString() };
            setStaffList((prev: any[]) => [...prev, staffEntry]);
            try { await cloudStorage.upsertStaff([staffEntry]); } catch(e) { console.error(e); }
            setCellSelection(null);
          }}
          onDelete={async (id: any) => {
            setStaffList((prev: any[]) => prev.filter((s: any) => s.id !== id));
            try { await (cloudStorage as any).deleteStaff(id); } catch(e) { console.error(e); }
            setCellSelection(null);
          }}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  tabHeader: { flexDirection: 'row', backgroundColor: COLORS.card, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: COLORS.primary, paddingBottom: 4 },
  dashboardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md, marginTop: SPACING.sm },
  headerBtns: { flexDirection: 'row', gap: 8 },
  iconBtn: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  gridContainer: { paddingHorizontal: SPACING.md, gap: SPACING.md },
  limitCard: { padding: SPACING.md, backgroundColor: 'rgba(56, 189, 248, 0.05)' },
  limitGrid: { flexDirection: 'row', gap: SPACING.sm, marginTop: 12 },
  limitItem: { flex: 1, backgroundColor: COLORS.card, padding: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  monthCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md, backgroundColor: COLORS.primary },
  alertCard: { marginHorizontal: SPACING.md, marginTop: SPACING.md, padding: SPACING.md, borderLeftWidth: 4 },
  alertRow: { flexDirection: 'row', alignItems: 'center' },
  pendingBadge: { backgroundColor: 'rgba(245, 158, 11, 0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.2)' },
  actionGrid: { flexDirection: 'row', gap: SPACING.md, padding: SPACING.md },
  actionBtn: { flex: 1, backgroundColor: COLORS.primary, padding: 16, borderRadius: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 12, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
  fullGridCard: { margin: SPACING.md, padding: SPACING.sm },
  tableRow: { flexDirection: 'row', height: 40, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  tableHeader: { backgroundColor: 'rgba(255,255,255,0.02)' },
  staffCol: { width: 70, paddingLeft: 4, justifyContent: 'center' },
  dayCol: { width: 28, alignItems: 'center', justifyContent: 'center', height: '100%' },
  staffCard: { marginBottom: 12, overflow: 'hidden' },
  staffMain: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 16 },
  statusIndicator: { width: 4, height: 40, borderRadius: 2, marginRight: 16 },
  approveBtn: { backgroundColor: '#10b981', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginRight: 12 },
  settingsGroup: { padding: SPACING.md, marginBottom: SPACING.md },
  settingsItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 24, padding: 24, width: '100%', borderWidth: 1, borderColor: COLORS.border },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginVertical: 32 },
  counterBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 12 },
  cancelBtn: { flex: 1, height: 54, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  saveBtn: { flex: 1, height: 54, borderRadius: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary },
  input: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, height: 56, paddingHorizontal: 16, color: 'white', marginBottom: 24, fontSize: 16 },
});
