import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, ScrollView, TouchableOpacity, TextInput, Modal, Alert, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { User, LogOut, Settings, Shield, Bell, ChevronRight, ChevronLeft, Lock, Trash2, Info, FileDown, ExternalLink } from 'lucide-react-native';
import * as Linking from 'expo-linking';
import { APP_CONFIG } from '../constants/Config';
import { STORAGE_KEYS } from '../utils/storage';
import { exportShiftToPDF } from '../utils/pdfExport';
import { sortStaffByName } from '../utils/staffUtils';
import { getCurrentLimit } from '../utils/limitUtils';
import { getDateStr } from '../utils/dateUtils';

interface ProfileScreenProps {
  staffList: any[];
  setStaffList: (list: any[] | ((prev: any[]) => any[])) => void;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  profile: any;
  setProfile: (profile: any) => void;
  weekdayLimit: number;
  holidayLimit: number;
  saturdayLimit: number;
  sundayLimit: number;
  publicHolidayLimit: number;
  monthlyLimits: Record<string, { weekday: number, sat: number, sun: number, pub: number }>;
  updateLimits: (type: 'weekday' | 'holiday' | 'saturday' | 'sunday' | 'publicHoliday', val: number, monthStr?: string) => void;
  adminPassword: any;
  updatePassword: (pass: string) => void;
  isAdminAuthenticated: boolean;
  setIsAdminAuthenticated: (val: boolean) => void;
  staffViewMode?: boolean;
  setStaffViewMode?: (val: boolean) => void;
  sessionDuration?: number;
  setSessionDuration?: (val: number) => void;
  onLogout?: () => void;
  currentDate: Date;
  setCurrentDate: (d: Date | ((prev: Date) => Date)) => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  staffList, setStaffList, requests, setRequests, profile, setProfile, 
  weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit, 
  monthlyLimits, updateLimits, adminPassword, updatePassword,
  isAdminAuthenticated, setIsAdminAuthenticated,
  staffViewMode = false, setStaffViewMode = () => {},
  sessionDuration = 24, setSessionDuration = () => {},
  onLogout = () => {},
  currentDate, setCurrentDate
}) => {
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pendingAction, setPendingAction] = useState<any>(null);
  const [isUserSwitchModalVisible, setIsUserSwitchModalVisible] = useState(false);
  const [isPassChangeModalVisible, setIsPassChangeModalVisible] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [editingStaff, setEditingStaff] = useState<any>(null);
  const [newName, setNewName] = useState('');
  const [newPosition, setNewPosition] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [newProfession, setNewProfession] = useState('PT');
  const [newRole, setNewRole] = useState('一般職員');
  const [newNoHoliday, setNewNoHoliday] = useState(false);
  const [newIsApproved, setNewIsApproved] = useState(true);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [isMyPassModalVisible, setIsMyPassModalVisible] = useState(false);
  const [myPasswordInput, setMyPasswordInput] = useState('');
  const [sortingStaff, setSortingStaff] = useState<any>(null);

  const limitMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

  const changeLimitMonth = (dir: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + (dir === 'next' ? 1 : -1));
      return d;
    });
  };

  const currentMonthly = monthlyLimits[limitMonth] || {
    weekday: weekdayLimit,
    sat: saturdayLimit,
    sun: sundayLimit,
    pub: publicHolidayLimit
  };

  const isPrivileged = ((profile.role?.includes('シフト管理者') || profile.role?.includes('開発者')) && !staffViewMode) || isAdminAuthenticated;
  const isActualAdmin = (profile.role?.includes('シフト管理者') || profile.role?.includes('開発者'));

  const moveStaff = (index: number, direction: 'up' | 'down') => {
    if (!isPrivileged) return;
    const newList = [...staffList];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newList.length) return;
    
    setStaffList(prev => {
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
    setSortingStaff(null);
  };

  const updateProfileLocal = async (key: string, value: any) => {
    let newProfile = { ...profile, [key]: value, updatedAt: new Date().toISOString() };
    const wasLongTerm = profile.position === '長期休暇' || profile.status === '長期休暇';
    const isNowLongTerm = newProfile.position === '長期休暇' || newProfile.status === '長期休暇';
    
    if (wasLongTerm && (key === 'position' || key === 'status') && value !== '長期休暇') {
      newProfile.position = (key === 'position') ? value : '主査';
      newProfile.status = (key === 'status') ? value : '出勤';
    } else if (isNowLongTerm) {
      newProfile.position = '長期休暇';
      newProfile.status = '長期休暇';
      if (!wasLongTerm) {
        const todayStr = getDateStr(new Date());
        setRequests(prev => prev.filter(r => !(r.staffName === profile.name && r.date >= todayStr)));
      }
    }
    
    setProfile(newProfile);

    const isLongTermSync = newProfile.position === '長期休暇' || newProfile.status === '長期休暇';
    setStaffList(prev => prev.map(s => {
      if (s.name === profile.name) {
        let updated = { ...s, [key]: value };
        if (isLongTermSync) {
          updated.position = '長期休暇';
          updated.status = '長期休暇';
        } else if (wasLongTerm) {
          if (updated.status === '長期休暇') updated.status = '出勤';
          if (updated.position === '長期休暇') updated.position = '主査';
        }
        return updated;
      }
      return s;
    }));
  };

  const checkPassword = (onSuccess: () => void) => {
    if (isAdminAuthenticated) {
      onSuccess();
      return;
    }
    setPendingAction(() => onSuccess);
    setPasswordInput('');
    setIsPasswordModalVisible(true);
  };

  const handlePasswordSubmit = () => {
    if (passwordInput === adminPassword) {
      setIsAdminAuthenticated(true);
      setIsPasswordModalVisible(false);
      if (pendingAction) pendingAction();
      setPendingAction(null);
    } else {
      Alert.alert('エラー', 'パスワードが正しくありません。');
    }
  };

  const cycleValue = (current: string, list: string[], key: string) => {
    const displayList = key === 'status' ? [...list, '入職前'] : list;
    const currentIndex = displayList.indexOf(current);
    const nextIndex = (currentIndex + 1) % displayList.length;
    const nextValue = displayList[nextIndex];
    if (isPrivileged) updateProfileLocal(key, nextValue);
    else checkPassword(() => updateProfileLocal(key, nextValue));
  };

  const switchUser = (staff: any) => {
    const newProfile = {
      name: staff.name,
      placement: staff.placement || '2F',
      position: staff.position || '主事',
      role: staff.role || '一般職員'
    };
    setProfile(newProfile);
    setIsUserSwitchModalVisible(false);
    Alert.alert('ユーザー切り替え', staff.name + 'としてログインしました。');
  };

  const changeMyPassword = () => {
    if (myPasswordInput.length < 4) {
      Alert.alert('エラー', 'パスワードは4文字以上で入力してください。');
      return;
    }
    updateProfileLocal('password', myPasswordInput);
    setIsMyPassModalVisible(false);
    setMyPasswordInput('');
    Alert.alert('完了', 'パスワードを変更しました。');
  };


  const changeAdminPassword = () => {
    if (newPasswordInput.length < 4) {
      Alert.alert('エラー', 'パスワードは4文字以上で入力してください。');
      return;
    }
    updatePassword(newPasswordInput);
    setIsPassChangeModalVisible(false);
    setNewPasswordInput('');
    Alert.alert('完了', '管理者パスワードを変更しました。');
  };

  const deleteStaff = (id: number | string) => {
    if (!isPrivileged) return;
    const staff = staffList.find(s => s.id === id);
    if (!staff) return;
    Alert.alert('職員の削除', `${staff.name} さんのデータを削除してもよろしいですか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: () => {
        setStaffList(prev => prev.filter(s => s.id !== id));
        setRequests(prev => prev.filter(r => r.staffName !== staff.name));
        setIsEditModalVisible(false);
      }}
    ]);
  };

  const saveStaffChanges = () => {
    if (!isPrivileged || !editingStaff) return;
    
    setStaffList(prev => prev.map(s => s.id === editingStaff?.id ? { 
      ...s, 
      role: newRole,
      updatedAt: new Date().toISOString()
    } : s));

    if (editingStaff.name === profile.name) {
      setProfile({
        ...profile, 
        role: newRole
      });
    }

    setIsEditModalVisible(false);
    setEditingStaff(null);
  };

  const handleLogoutLocal = () => {
    if (Platform.OS === 'web') {
      onLogout();
    } else {
      Alert.alert(
        'ログアウト',
        '本当にログアウトしますか？',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: 'ログアウト',
            style: 'destructive',
            onPress: () => {
              onLogout();
            },
          },
        ]
      );
    }
  };



  const positions = ['科長', '係長', '主査', '主任', '主事', '会計年度', '時短勤務'];
  const placements = ['2F', '3F', '4F', '外来', 'フォロー', '兼務', '包括', '排尿支援', '訪問', '管理', '助手'];
  const professions = ['PT', 'OT', 'ST', '助手', 'その他'];
  const statuses = ['出勤', '休暇', '長期休暇', '入職前'];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <ThemeText variant="h1">設定</ThemeText>
          <ThemeText variant="caption">アプリの設定とプロフィールの管理</ThemeText>
        </View>

        <ThemeCard style={styles.profileCard}>
          <TouchableOpacity style={styles.userSwitchRow} onPress={() => setIsUserSwitchModalVisible(true)}>
            <View style={styles.avatar}>
              <User color={COLORS.primary} size={30} />
            </View>
            <View style={styles.userInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <ThemeText variant="h2">{profile.name}</ThemeText>
              </View>
              <ThemeText variant="caption">{profile.role}</ThemeText>
            </View>
            <ChevronRight color={COLORS.textSecondary} size={20} />
          </TouchableOpacity>
        </ThemeCard>


        <ThemeText variant="label" style={styles.sectionTitle}>アカウントセキュリティ</ThemeText>
        <ThemeCard style={styles.settingsSection}>
          <TouchableOpacity style={[styles.settingItem, { borderBottomWidth: 0 }]} onPress={() => setIsMyPassModalVisible(true)}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Lock size={16} color={COLORS.primary} style={{ marginRight: 8 }} />
              <ThemeText>ログインパスワード変更</ThemeText>
            </View>
            <ThemeText color={COLORS.textSecondary}>設定済み</ThemeText>
          </TouchableOpacity>
        </ThemeCard>

        <ThemeText variant="label" style={styles.sectionTitle}>その他</ThemeText>
        <ThemeCard style={styles.settingsSection}>
          <TouchableOpacity style={[styles.actionItem, { borderBottomWidth: 0 }]} onPress={handleLogoutLocal}>
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <LogOut size={20} color={COLORS.danger} />
            </View>
            <View style={styles.actionTextContainer}>
              <ThemeText variant="body" bold color={COLORS.danger}>ログアウト</ThemeText>
              <ThemeText variant="caption" color={COLORS.textSecondary}>現在のアカウントからログアウトします</ThemeText>
            </View>
            <ChevronRight size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </ThemeCard>

        {(isPrivileged || (isActualAdmin && staffViewMode)) && (
          <>
            <ThemeText variant="label" style={styles.sectionTitle}>管理者メニュー</ThemeText>
            <ThemeCard style={styles.settingsSection}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                <ThemeText bold>設定対象月</ThemeText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <TouchableOpacity onPress={() => changeLimitMonth('prev')} style={styles.smallBtn}><ChevronLeft size={16} color={COLORS.textSecondary} /></TouchableOpacity>
                  <ThemeText bold color={COLORS.primary}>{limitMonth.replace('-', '年')}月</ThemeText>
                  <TouchableOpacity onPress={() => changeLimitMonth('next')} style={styles.smallBtn}><ChevronRight size={16} color={COLORS.textSecondary} /></TouchableOpacity>
                </View>
              </View>

              <View style={styles.limitSettingItem}>
                <ThemeText>施設全体勤務制限 (平日)</ThemeText>
                <View style={styles.limitControls}>
                  <TouchableOpacity onPress={() => updateLimits('weekday', Math.max(0, currentMonthly.weekday - 1), limitMonth)} style={styles.smallBtn}><ThemeText>-</ThemeText></TouchableOpacity>
                  <ThemeText style={styles.limitValue}>{currentMonthly.weekday}</ThemeText>
                  <TouchableOpacity onPress={() => updateLimits('weekday', currentMonthly.weekday + 1, limitMonth)} style={styles.smallBtn}><ThemeText>+</ThemeText></TouchableOpacity>
                </View>
              </View>
              <View style={styles.limitSettingItem}>
                <ThemeText>施設全体勤務制限 (土曜)</ThemeText>
                <View style={styles.limitControls}>
                  <TouchableOpacity onPress={() => updateLimits('saturday', Math.max(0, currentMonthly.sat - 1), limitMonth)} style={styles.smallBtn}><ThemeText>-</ThemeText></TouchableOpacity>
                  <ThemeText style={styles.limitValue}>{currentMonthly.sat}</ThemeText>
                  <TouchableOpacity onPress={() => updateLimits('saturday', currentMonthly.sat + 1, limitMonth)} style={styles.smallBtn}><ThemeText>+</ThemeText></TouchableOpacity>
                </View>
              </View>
              <View style={styles.limitSettingItem}>
                <ThemeText>施設全体勤務制限 (祝日)</ThemeText>
                <View style={styles.limitControls}>
                  <TouchableOpacity onPress={() => updateLimits('publicHoliday', Math.max(0, currentMonthly.pub - 1), limitMonth)} style={styles.smallBtn}><ThemeText>-</ThemeText></TouchableOpacity>
                  <ThemeText style={styles.limitValue}>{currentMonthly.pub}</ThemeText>
                  <TouchableOpacity onPress={() => updateLimits('publicHoliday', currentMonthly.pub + 1, limitMonth)} style={styles.smallBtn}><ThemeText>+</ThemeText></TouchableOpacity>
                </View>
              </View>
              <View style={styles.limitSettingItem}>
                <ThemeText>施設全体勤務制限 (日曜)</ThemeText>
                <View style={styles.limitControls}>
                  <TouchableOpacity onPress={() => updateLimits('sunday', Math.max(0, currentMonthly.sun - 1), limitMonth)} style={styles.smallBtn}><ThemeText>-</ThemeText></TouchableOpacity>
                  <ThemeText style={styles.limitValue}>{currentMonthly.sun}</ThemeText>
                  <TouchableOpacity onPress={() => updateLimits('sunday', currentMonthly.sun + 1, limitMonth)} style={styles.smallBtn}><ThemeText>+</ThemeText></TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity style={[styles.settingItem, { borderBottomWidth: 1 }]} onPress={() => setIsPassChangeModalVisible(true)}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Lock size={16} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
                  <ThemeText>管理者パスワード変更</ThemeText>
                </View>
                <ChevronRight size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>

              <View style={[styles.settingItem, { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <ThemeText>ログイン保持期間</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>セッション有効期限</ThemeText>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity 
                    onPress={() => {
                      const options = [1, 12, 24, 72, 168, 720]; // 1h, 12h, 1d, 3d, 1w, 1m
                      const currentIndex = options.indexOf(sessionDuration);
                      const nextIndex = (currentIndex + 1) % options.length;
                      setSessionDuration(options[nextIndex]);
                    }}
                    style={[styles.smallBtn, { paddingHorizontal: 12, width: 'auto' }]}
                  >
                    <ThemeText bold color={COLORS.primary}>
                      {sessionDuration === 1 ? '1時間' : 
                       sessionDuration === 12 ? '12時間' : 
                       sessionDuration === 24 ? '1日' : 
                       sessionDuration === 72 ? '3日' : 
                       sessionDuration === 168 ? '1週間' : '1ヶ月'}
                    </ThemeText>
                  </TouchableOpacity>
                </View>
              </View>
            </ThemeCard>



            {isAdminAuthenticated && (
              <TouchableOpacity 
                style={[styles.profileCard, { marginTop: 24, paddingVertical: 14, alignItems: 'center', backgroundColor: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.2)', borderWidth: 1 }]} 
                onPress={() => {
                  setIsAdminAuthenticated(false);
                  Alert.alert('ログアウト', 'シフト管理者モードを終了しました。');
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <LogOut size={20} color={COLORS.danger} />
                  <ThemeText bold color={COLORS.danger}>管理者モードを終了</ThemeText>
                </View>
              </TouchableOpacity>
            )}

            <ThemeText variant="label" style={styles.sectionTitle}>職員マスタ設定</ThemeText>
            <ThemeCard style={styles.settingsSection}>
              {sortStaffByName(staffList).map((staff, index) => (
                <View key={staff.id} style={[styles.staffListItem, index === staffList.length - 1 && { borderBottomWidth: 0 }]}>
                  <TouchableOpacity 
                    style={styles.staffItemInfo} 
                    onPress={() => { 
                      setEditingStaff(staff); 
                      setNewName(staff.name); 
                      setNewPosition(staff.position); 
                      setNewStatus(staff.status); 
                      setNewProfession(staff.profession || 'PT');
                      setNewRole(staff.role || '一般職員');
                      setNewNoHoliday(staff.noHoliday ?? false);
                      setNewIsApproved(staff.isApproved !== false);
                      setIsEditModalVisible(true); 
                    }}
                  >
                    <ThemeText>{staff.name}</ThemeText>
                    <ThemeText variant="caption" color={COLORS.textSecondary}>
                      {staff.placement} / {staff.position} {staff.profession ? `(${staff.profession})` : ''}
                    </ThemeText>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteStaff(staff.id)} style={styles.deleteBtn}>
                    <Trash2 size={18} color={COLORS.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </ThemeCard>
          </>
        )}
      </ScrollView>

      {/* Modals */}

      <Modal visible={isUserSwitchModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <ThemeText variant="h2" style={{ marginBottom: 16 }}>ユーザーを選択</ThemeText>
            <ScrollView>
              {staffList.map((staff) => (
                <TouchableOpacity key={staff.id} style={styles.switchItem} onPress={() => switchUser(staff)}>
                  <ThemeText>{staff.name}</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>{staff.placement} / {staff.position}</ThemeText>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setIsUserSwitchModalVisible(false)} style={styles.closeBtn}><ThemeText color={COLORS.primary} bold>閉じる</ThemeText></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isMyPassModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ThemeText variant="h2" style={{ marginBottom: 16 }}>ログインパスワード設定</ThemeText>
            <ThemeText variant="caption" style={{ marginBottom: 8 }}>Web版などでのログインに使用します</ThemeText>
            <TextInput 
              style={styles.modalInput} 
              placeholder="新しいパスワード（4桁数字推奨）" 
              secureTextEntry 
              keyboardType="numeric" 
              value={myPasswordInput} 
              onChangeText={setMyPasswordInput} 
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setIsMyPassModalVisible(false)} style={styles.cancelBtn}><ThemeText>キャンセル</ThemeText></TouchableOpacity>
              <TouchableOpacity onPress={changeMyPassword} style={styles.confirmBtn}><ThemeText color="white" bold>保存する</ThemeText></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      <Modal visible={isPassChangeModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ThemeText variant="h2" style={{ marginBottom: 16 }}>新パスワード設定</ThemeText>
            <TextInput style={styles.modalInput} placeholder="新しいパスワードを入力" secureTextEntry keyboardType="numeric" value={newPasswordInput} onChangeText={setNewPasswordInput} />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setIsPassChangeModalVisible(false)} style={styles.cancelBtn}><ThemeText>キャンセル</ThemeText></TouchableOpacity>
              <TouchableOpacity onPress={changeAdminPassword} style={styles.confirmBtn}><ThemeText color="white" bold>変更する</ThemeText></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isEditModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <ThemeText variant="h2">権限の変更</ThemeText>
              <TouchableOpacity onPress={() => deleteStaff(editingStaff?.id)}><Trash2 size={24} color={COLORS.danger} /></TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={{ marginBottom: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                <ThemeText variant="label" style={{ marginBottom: 4 }}>対象職員</ThemeText>
                <ThemeText variant="h2" color={COLORS.primary}>{editingStaff?.name}</ThemeText>
              </View>

              <ThemeText variant="label" style={{ marginBottom: 8 }}>権限設定 (Role)</ThemeText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4, width: '100%' }}>
                <TouchableOpacity 
                  activeOpacity={0.7}
                  style={[
                    styles.roleCard, 
                    (newRole === '一般職員' || !newRole) && { borderColor: COLORS.primary, borderWidth: 3, backgroundColor: 'rgba(56, 189, 248, 0.1)' }
                  ]} 
                  onPress={() => setNewRole('一般職員')}
                >
                  <User size={20} color={(newRole === '一般職員' || !newRole) ? COLORS.text : COLORS.textSecondary} />
                  <ThemeText bold={newRole === '一般職員' || !newRole} color={(newRole === '一般職員' || !newRole) ? COLORS.text : COLORS.textSecondary}>一般職員</ThemeText>
                </TouchableOpacity>

                <TouchableOpacity 
                  activeOpacity={0.7}
                  style={[
                    styles.roleCard, 
                    newRole.includes('シフト管理者') && { borderColor: COLORS.primary, borderWidth: 3, backgroundColor: 'rgba(56, 189, 248, 0.2)' }
                  ]} 
                  onPress={() => {
                    checkPassword(() => {
                      if (newRole.includes('シフト管理者')) {
                        const next = newRole.split(',').filter(r => r !== 'シフト管理者').join(',');
                        setNewRole(next || '一般職員');
                      } else {
                        const currentRoles = newRole.split(',').filter(r => r !== '一般職員');
                        if (!currentRoles.includes('シフト管理者')) {
                          setNewRole([...currentRoles, 'シフト管理者'].join(','));
                        }
                      }
                    });
                  }}
                >
                  <Shield size={20} color={newRole.includes('シフト管理者') ? COLORS.primary : COLORS.textSecondary} />
                  <ThemeText bold={newRole.includes('シフト管理者')} color={newRole.includes('シフト管理者') ? COLORS.primary : COLORS.textSecondary}>管理者</ThemeText>
                </TouchableOpacity>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setIsEditModalVisible(false)} style={styles.cancelBtn}><ThemeText>キャンセル</ThemeText></TouchableOpacity>
              <TouchableOpacity onPress={saveStaffChanges} style={styles.confirmBtn}><ThemeText color="white" bold>保存する</ThemeText></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!sortingStaff} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ThemeText variant="h2" style={{ marginBottom: 20 }}>{sortingStaff?.name} の順序移動</ThemeText>
            <View style={{ gap: 12 }}>
              <TouchableOpacity 
                style={[styles.sortBtn, sortingStaff?.index === 0 && { opacity: 0.5 }]} 
                onPress={() => moveStaff(sortingStaff.index, 'up')}
                disabled={sortingStaff?.index === 0}
              >
                <ThemeText bold>上へ移動</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.sortBtn, sortingStaff?.index === staffList.length - 1 && { opacity: 0.5 }]} 
                onPress={() => moveStaff(sortingStaff.index, 'down')}
                disabled={sortingStaff?.index === staffList.length - 1}
              >
                <ThemeText bold>下へ移動</ThemeText>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setSortingStaff(null)} style={[styles.closeBtn, { marginTop: 20 }]}>
              <ThemeText color={COLORS.primary} bold>キャンセル</ThemeText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isPasswordModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ThemeText variant="h2" style={{ marginBottom: 16 }}>管理者パスワード</ThemeText>
            <TextInput style={styles.modalInput} placeholder="****" secureTextEntry keyboardType="numeric" value={passwordInput} onChangeText={setPasswordInput} autoFocus />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setIsPasswordModalVisible(false)} style={styles.cancelBtn}><ThemeText>キャンセル</ThemeText></TouchableOpacity>
              <TouchableOpacity onPress={handlePasswordSubmit} style={styles.confirmBtn}><ThemeText color="white" bold>確認</ThemeText></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: SPACING.md, paddingBottom: 40 },
  header: { marginBottom: SPACING.xl, marginTop: SPACING.md },
  profileCard: { padding: SPACING.md, marginBottom: SPACING.xl },
  userSwitchRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(56, 189, 248, 0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  userInfo: { flex: 1 },
  sectionTitle: { marginBottom: 8, marginLeft: 4, marginTop: 16 },
  settingsSection: { padding: 0, overflow: 'hidden' },
  settingItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  limitSettingItem: { padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  limitControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  smallBtn: { width: 30, height: 30, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  limitValue: { fontSize: 16, fontWeight: 'bold', minWidth: 24, textAlign: 'center' },
  staffListItem: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  staffItemInfo: { flex: 1 },
  deleteBtn: { padding: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 24, padding: 24, width: '100%', borderWidth: 1, borderColor: COLORS.border },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, paddingHorizontal: 16, height: 50, color: COLORS.text, fontSize: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 24, gap: 12 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  confirmBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20 },
  switchItem: { padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  closeBtn: { marginTop: 20, padding: 10, alignSelf: 'center' },
  selectorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectorChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: COLORS.border, minWidth: 60, alignItems: 'center' },
  selectorChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  sortBtn: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  roleCard: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.05)', backgroundColor: 'transparent' },
  actionItem: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  actionIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  actionTextContainer: { flex: 1 },
});
