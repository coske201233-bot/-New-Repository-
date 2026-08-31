import React, { useState, useMemo, useEffect } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Alert, TextInput, SafeAreaView, Platform, Text, Button } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { 
  ChevronLeft, ChevronRight, Calendar, User, 
  Check, X, Clock, MapPin, Briefcase, Settings, Shield, Printer, Plus, Pencil, LogOut,
  UserPlus, Key, Trash2, Eye, EyeOff, Lock, AlertTriangle, UserX, UserCheck, ShieldAlert
} from 'lucide-react-native';
import { getMonthInfo, getDayType, isHoliday, getDateStr, normalizeDateStr } from '../utils/dateUtils';
import { normalizeName } from '../utils/staffUtils';
import { cloudStorage } from '../utils/cloudStorage';
import { supabase } from '../utils/supabase';
import { calculateRemainingLeaveHours, formatRemainingLeave, calculateUsedLeaveHours, calculateMandatoryLeaveStatus } from '../utils/leaveUtils';
import { createStaffApi, updateStaffInfoApi, updateStaffPasswordApi, deleteStaffApi, directStaffDbUpdate } from '../utils/adminStaffApi';
import { recordAuditLog } from '../utils/auditLogger';
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
  onForceCloudSync?: () => Promise<boolean>;
  onLogout?: () => void;
  fetchShifts?: () => Promise<void>;
  shifts?: any[];
}

interface MonthDay {
  day: number;
  dateStr: string;
  isH?: boolean;
  empty: boolean;
}

export const StaffScreen: React.FC<StaffScreenProps> = (props) => {
  const { 
    staffList, setStaffList, 
    requests, setRequests, onDeleteRequest, isPrivileged, profile, 
    currentDate, setCurrentDate,
    fetchShifts, shifts
  } = props;

  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);
  const activeDate = currentDate || new Date();
  const setActiveDate = setCurrentDate;
  
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState('出勤');
  const [selectedHours, setSelectedHours] = useState(1.0);
  const [specialHours, setSpecialHours] = useState(1.0);
  const [hourlyHours, setHourlyHours] = useState(1.0);
  const [isSaving, setIsSaving] = useState(false);

  // --- [CRITICAL: FALLBACK UI FOR WSOD PREVENTION] ---
  if (!staffList || !requests) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <ThemeText style={{ marginTop: 24, marginBottom: 8 }} variant="h2">データを読み込み中...</ThemeText>
        <TouchableOpacity 
          style={{ marginTop: 40, backgroundColor: 'rgba(239, 68, 68, 0.1)', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#ef4444' }}
          onPress={() => props.onLogout ? props.onLogout() : supabase.auth.signOut()}
        >
          <ThemeText color="#ef4444" bold>ログアウトして戻る</ThemeText>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const isAdminAuthenticated = props.isAdminAuthenticated || isPrivileged;
  const userRole = isAdminAuthenticated ? 'admin' : 'staff';

  const activeMonthKey = activeDate ? `${activeDate.getFullYear()}-${activeDate.getMonth()}` : '';
  const fetchShiftsRef = React.useRef(fetchShifts);
  fetchShiftsRef.current = fetchShifts;

  useEffect(() => {
    if (fetchShiftsRef.current) fetchShiftsRef.current();
  }, [activeMonthKey]);

  // --- [CRITICAL: FORCE RE-FETCH ON FOCUS & DEBUG] ---
  const runDebugFetch = async () => {
    try {
      const { data, error } = await supabase.from('staff').select('*');
      if (error) {
        console.error("FETCH ERROR:", error);
      } else if (data) {
        const mappedData = data.map((item: any) => {
          const uKey = `initial_leave_days_${item.id || item.email || item.name}`;
          let initDays = 20;

          if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(uKey);
            if (saved !== null && !isNaN(parseFloat(saved))) {
              initDays = parseFloat(saved);
            } else if (item.initial_leave_days !== null && item.initial_leave_days !== undefined && !isNaN(Number(item.initial_leave_days))) {
              initDays = Number(item.initial_leave_days);
              localStorage.setItem(uKey, String(initDays));
            }
          } else if (item.initial_leave_days !== null && item.initial_leave_days !== undefined && !isNaN(Number(item.initial_leave_days))) {
            initDays = Number(item.initial_leave_days);
          }

          let leaveStart = item.leave_start_date || item.leaveStartDate || null;
          let leaveEnd = item.leave_end_date || item.leaveEndDate || null;
          if (item.status !== '長期休暇') {
            leaveStart = null;
            leaveEnd = null;
            if (typeof window !== 'undefined') {
              localStorage.removeItem(`leave_start_date_${item.id}`);
              if (item.email) localStorage.removeItem(`leave_start_date_${item.email}`);
              if (item.name) localStorage.removeItem(`leave_start_date_${item.name}`);
              localStorage.removeItem(`leave_end_date_${item.id}`);
              if (item.email) localStorage.removeItem(`leave_end_date_${item.email}`);
              if (item.name) localStorage.removeItem(`leave_end_date_${item.name}`);
            }
          } else if (typeof window !== 'undefined') {
            const lsStart = localStorage.getItem(`leave_start_date_${item.id}`) || localStorage.getItem(`leave_start_date_${item.email}`) || localStorage.getItem(`leave_start_date_${item.name}`);
            const lsEnd = localStorage.getItem(`leave_end_date_${item.id}`) || localStorage.getItem(`leave_end_date_${item.email}`) || localStorage.getItem(`leave_end_date_${item.name}`);
            
            if (leaveStart) {
              localStorage.setItem(`leave_start_date_${item.id}`, leaveStart);
              if (item.email) localStorage.setItem(`leave_start_date_${item.email}`, leaveStart);
              if (item.name) localStorage.setItem(`leave_start_date_${item.name}`, leaveStart);
            } else if (lsStart) {
              leaveStart = lsStart;
            }

            if (leaveEnd) {
              localStorage.setItem(`leave_end_date_${item.id}`, leaveEnd);
              if (item.email) localStorage.setItem(`leave_end_date_${item.email}`, leaveEnd);
              if (item.name) localStorage.setItem(`leave_end_date_${item.name}`, leaveEnd);
            } else if (lsEnd) {
              leaveEnd = lsEnd;
            }
          }

          return {
            ...item,
            initial_leave_days: initDays,
            initialLeaveDays: initDays,
            leave_start_date: leaveStart,
            leaveStartDate: leaveStart,
            leave_end_date: leaveEnd,
            leaveEndDate: leaveEnd
          };
        });
        setDebugStaffList(mappedData);
      }
    } catch (e) {
      console.error("DEBUG FETCH EXCEPTION:", e);
    }
  };

  // タブが切り替わってこのコンポーネントがマウントされるたびにクラウドから最新データを取得します
  useEffect(() => {
    runDebugFetch();
  }, []);

  // [NEW] 自動的に自分のカレンダーを開くロジック (一般スタッフ用)
  useEffect(() => {
    if (profile && !isAdminAuthenticated && !selectedStaff && staffList.length > 0) {
      const me = staffList.find(s => s && (s.id === profile.id || normalize(s.name) === normalize(profile.name)));
      if (me) {
        setSelectedStaff(me);
        setIsCalendarModalVisible(true);
      }
    }
  }, [profile, staffList, isAdminAuthenticated]);

  // --- Staff Management Form States (Admin) ---
  const [isRegistrationModalVisible, setIsRegistrationModalVisible] = useState(false);
  const [isNewStaffModalVisible, setIsNewStaffModalVisible] = useState(false);
  
  // Edit Form States
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regAppRole, setRegAppRole] = useState('一般スタッフ');
  const [regTitle, setRegTitle] = useState('主事');
  const [regJobType, setRegJobType] = useState('PT');
  const [regPlacement, setRegPlacement] = useState('4F');
  const [regStatus, setRegStatus] = useState('常勤');
  const [regLeaveStartDate, setRegLeaveStartDate] = useState('');
  const [regLeaveEndDate, setRegLeaveEndDate] = useState('');
  const [activeLeaveDatePicker, setActiveLeaveDatePicker] = useState<'start' | 'end' | null>(null);
  const [leavePickerMonth, setLeavePickerMonth] = useState<Date>(new Date());
  const [regInitialLeaveDays, setRegInitialLeaveDays] = useState('20');
  const [editingStaff, setEditingStaff] = useState<any>(null);
  const [regHolidaySetting, setRegHolidaySetting] = useState(false);
  const [showHolidayPicker, setShowHolidayPicker] = useState(false);
  
  // Password Change in Edit Modal
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordChangeMsg, setPasswordChangeMsg] = useState('');
  
  // New Staff Registration Form States
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewStaffPassword, setShowNewStaffPassword] = useState(false);
  const [newAppRole, setNewAppRole] = useState('一般スタッフ');
  const [newTitle, setNewTitle] = useState('主事');
  const [newJobType, setNewJobType] = useState('PT');
  const [newPlacement, setNewPlacement] = useState('4F');
  const [newStatus, setNewStatus] = useState('常勤');
  const [newInitialLeaveDays, setNewInitialLeaveDays] = useState('20');
  const [newHolidaySetting, setNewHolidaySetting] = useState(false);
  const [showNewHolidayPicker, setShowNewHolidayPicker] = useState(false);
  const [newStaffStatusMsg, setNewStaffStatusMsg] = useState('');
  const [isCreatingStaff, setIsCreatingStaff] = useState(false);

  // --- [ON-SCREEN DEBUGGING & FAIL-SAFE RENDER] ---
  const [statusMsg, setStatusMsg] = useState("");
  const [debugError, setDebugError] = useState<string | null>(null);
  const [debugStaffList, setDebugStaffList] = useState<any[]>([]);
  const staff = debugStaffList; // Alias for user requirement snippet

  // Multi-choice options (Custom Hospital Structure)
  const APP_ROLES = ['管理者', '一般スタッフ'];
  const JOB_TYPES = ['PT', 'OT', 'ST', '助手'];
  const TITLES = ['科長', '科長補佐', '係長', '主査', '主任', '主事', '会計年度'];
  const PLACEMENTS = ['２F', '包括', '4F', '外来', 'フォロー', '兼務', '管理', '事務', '排尿管理', '訪問リハ'];
  const STATUSES = ['常勤', '時短勤務', '長期休暇', '無効', 'その他'];

  const handleOpenRegistration = (staffToEdit: any) => {
    if (!staffToEdit) return;

    setEditingStaff(staffToEdit);
    setRegName(staffToEdit.name || '');
    setRegEmail(staffToEdit.email || '');

    const uKey1 = `initial_leave_days_${staffToEdit.id}`;
    const uKey2 = `initial_leave_days_${staffToEdit.email}`;
    const uKey3 = `initial_leave_days_${staffToEdit.name}`;
    let savedVal = Number(staffToEdit.initial_leave_days ?? staffToEdit.initialLeaveDays ?? 20);

    if (typeof window !== 'undefined') {
      const s1 = localStorage.getItem(uKey1);
      const s2 = localStorage.getItem(uKey2);
      const s3 = localStorage.getItem(uKey3);
      if (s1 !== null && !isNaN(parseFloat(s1))) savedVal = parseFloat(s1);
      else if (s2 !== null && !isNaN(parseFloat(s2))) savedVal = parseFloat(s2);
      else if (s3 !== null && !isNaN(parseFloat(s3))) savedVal = parseFloat(s3);
    }
    setRegInitialLeaveDays(String(savedVal));

    let leaveStartVal = staffToEdit.leave_start_date || staffToEdit.leaveStartDate || '';
    let leaveEndVal = staffToEdit.leave_end_date || staffToEdit.leaveEndDate || '';
    if (typeof window !== 'undefined') {
      const ls1 = localStorage.getItem(`leave_start_date_${staffToEdit.id}`) || localStorage.getItem(`leave_start_date_${staffToEdit.email}`) || localStorage.getItem(`leave_start_date_${staffToEdit.name}`);
      const le1 = localStorage.getItem(`leave_end_date_${staffToEdit.id}`) || localStorage.getItem(`leave_end_date_${staffToEdit.email}`) || localStorage.getItem(`leave_end_date_${staffToEdit.name}`);
      if (ls1) leaveStartVal = ls1;
      if (le1) leaveEndVal = le1;
    }
    setRegLeaveStartDate(leaveStartVal);
    setRegLeaveEndDate(leaveEndVal);
    
    // アプリ権限: DBの role カラム（"管理者,スタッフ" 等）を基に判定
    const isUserAdmin = staffToEdit.role?.includes('管理者') || staffToEdit.permissions?.includes('管理者');
    setRegAppRole(isUserAdmin ? '管理者' : '一般スタッフ');

    // 役職: DBの position カラムの値を優先、無い場合は role からのフォールバック
    setRegTitle(staffToEdit.position || (TITLES.includes(staffToEdit.role) ? staffToEdit.role : '主事'));

    // 職種: DBの profession カラムの値を優先
    setRegJobType(staffToEdit.profession || staffToEdit.jobType || 'PT');

    setRegPlacement(staffToEdit.placement || '4F');
    setRegStatus(staffToEdit.status || '常勤');
    
    // 休日設定: DBの no_holiday カラムの値を優先
    setRegHolidaySetting(!!(staffToEdit.no_holiday ?? staffToEdit.noHoliday));
    
    // パスワード変更ステート初期化
    setNewPasswordInput('');
    setPasswordChangeMsg('');
    setStatusMsg('');
    
    setIsRegistrationModalVisible(true);
  };

  const handleOpenNewStaffModal = () => {
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    setNewAppRole('一般スタッフ');
    setNewTitle('主事');
    setNewJobType('PT');
    setNewPlacement('4F');
    setNewStatus('常勤');
    setNewInitialLeaveDays('20');
    setNewHolidaySetting(false);
    setNewStaffStatusMsg('');
    setIsNewStaffModalVisible(true);
  };

  const fetchStaff = async () => {
    await runDebugFetch();
    if (props.onForceCloudSync) {
      await props.onForceCloudSync();
    }
  };

  // 1. 新規スタッフ登録 (Auth & Staff 完全同期)
  const handleCreateStaff = async () => {
    const inputData = {
      name: newName,
      email: newEmail,
      hasPassword: !!newPassword,
      position: newTitle,
      profession: newJobType,
      placement: newPlacement,
      status: newStatus,
      role: newAppRole,
      initialLeaveDays: newInitialLeaveDays,
      holidaySetting: newHolidaySetting,
    };
    console.log('新規登録処理開始:', inputData);

    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
      const msg = '❌ 氏名、メールアドレス、初期パスワードを入力してください';
      setNewStaffStatusMsg(msg);
      Alert.alert('入力エラー', '氏名、メールアドレス、初期パスワードは必須項目です。');
      return;
    }

    if (newPassword.trim().length < 6) {
      const msg = '❌ パスワードは6文字以上で設定してください';
      setNewStaffStatusMsg(msg);
      Alert.alert('入力エラー', msg);
      return;
    }

    setNewStaffStatusMsg('登録処理中...');
    setIsCreatingStaff(true);

    try {
      const initLeaveDaysNum = parseFloat(newInitialLeaveDays) || 20;
      const cleanEmail = newEmail.trim().toLowerCase();
      const cleanName = newName.trim();

      console.log('createStaffApi 呼び出し開始...');
      const result = await createStaffApi({
        name: cleanName,
        email: cleanEmail,
        password: newPassword.trim(),
        position: newTitle,
        profession: newJobType,
        jobType: newJobType,
        placement: newPlacement,
        status: newStatus,
        role: newAppRole === '管理者' ? '管理者,スタッフ' : 'スタッフ',
        initial_leave_days: initLeaveDaysNum,
        no_holiday: newHolidaySetting,
        holidaySetting: newHolidaySetting,
      });

      console.log('新規登録成功:', result);
      setNewStaffStatusMsg('🎉 スタッフを新規登録しました！');
      await fetchStaff();

      setTimeout(() => {
        setNewStaffStatusMsg('');
        setIsNewStaffModalVisible(false);
        Alert.alert('登録完了', `${cleanName} さんのアカウント（Auth & Staff）が作成されました。`);
      }, 1000);
    } catch (err: any) {
      console.error('登録エラー:', err);
      const errMsg = err.message || '登録に失敗しました';
      setNewStaffStatusMsg(`❌ エラー: ${errMsg}`);
      Alert.alert('登録エラー', errMsg);
    } finally {
      setIsCreatingStaff(false);
    }
  };

  // 2. スタッフ情報更新 (Auth & Staff 完全同期)
  const handleRegisterStaff = async () => {
    if (!regName.trim() || !regEmail.trim()) {
      setStatusMsg('❌ 氏名とメールアドレスを入力してください');
      return;
    }
    setStatusMsg("保存中...");

    const finalEmail = regEmail.trim().toLowerCase();
    const isMasterAdmin = finalEmail === 'admin@reha.local';

    setIsSaving(true);
    try {
      const initLeaveDaysNum = parseFloat(regInitialLeaveDays) || 20;

      const leaveStart = regStatus === '長期休暇' ? (regLeaveStartDate.trim() || null) : null;
      const leaveEnd = regStatus === '長期休暇' ? (regLeaveEndDate.trim() || null) : null;

      const payload = {
        name: regName.trim(),
        email: finalEmail,
        position: regTitle,
        role: (isMasterAdmin || regAppRole === '管理者') ? '管理者,スタッフ' : 'スタッフ',
        profession: regJobType,
        placement: regPlacement,
        status: regStatus,
        leave_start_date: leaveStart,
        leave_end_date: leaveEnd,
        no_holiday: regHolidaySetting,
        initial_leave_days: initLeaveDaysNum,
      };

      if (editingStaff) {
        // localStorage 保存
        if (typeof window !== 'undefined') {
          const uKey1 = `initial_leave_days_${editingStaff.id}`;
          const uKey2 = `initial_leave_days_${finalEmail}`;
          const uKey3 = `initial_leave_days_${regName.trim()}`;
          localStorage.setItem(uKey1, String(initLeaveDaysNum));
          localStorage.setItem(uKey2, String(initLeaveDaysNum));
          localStorage.setItem(uKey3, String(initLeaveDaysNum));

          const lKeyStart1 = `leave_start_date_${editingStaff.id}`;
          const lKeyStart2 = `leave_start_date_${finalEmail}`;
          const lKeyStart3 = `leave_start_date_${regName.trim()}`;
          const lKeyEnd1 = `leave_end_date_${editingStaff.id}`;
          const lKeyEnd2 = `leave_end_date_${finalEmail}`;
          const lKeyEnd3 = `leave_end_date_${regName.trim()}`;
          if (leaveStart) {
            localStorage.setItem(lKeyStart1, leaveStart);
            localStorage.setItem(lKeyStart2, leaveStart);
            localStorage.setItem(lKeyStart3, leaveStart);
          } else {
            localStorage.removeItem(lKeyStart1);
            localStorage.removeItem(lKeyStart2);
            localStorage.removeItem(lKeyStart3);
          }
          if (leaveEnd) {
            localStorage.setItem(lKeyEnd1, leaveEnd);
            localStorage.setItem(lKeyEnd2, leaveEnd);
            localStorage.setItem(lKeyEnd3, leaveEnd);
          } else {
            localStorage.removeItem(lKeyEnd1);
            localStorage.removeItem(lKeyEnd2);
            localStorage.removeItem(lKeyEnd3);
          }
        }

        // サーバーサイド API 呼び出し (Auth & Staff 同期更新)
        try {
          await updateStaffInfoApi({
            staffId: editingStaff.id,
            userId: editingStaff.user_id,
            ...payload,
          });
        } catch (apiErr: any) {
          console.warn('⚠️ [StaffScreen] updateStaffInfoApi error, attempting directStaffDbUpdate fallback...', apiErr.message);
          try {
            await directStaffDbUpdate({
              staffId: editingStaff.id,
              userId: editingStaff.user_id,
              ...payload,
            });
          } catch (dbErr: any) {
            console.error('❌ [StaffScreen] directStaffDbUpdate also failed:', dbErr);
            throw apiErr;
          }
        }

        setStatusMsg('🎉 変更を保存しました！');
        if (props.setStaffList) {
          props.setStaffList((prev: any[]) => (prev || []).map(s => {
            if (s.id === editingStaff.id || s.email === finalEmail) {
              return {
                ...s,
                ...payload,
                leave_start_date: leaveStart,
                leaveStartDate: leaveStart,
                leave_end_date: leaveEnd,
                leaveEndDate: leaveEnd,
              };
            }
            return s;
          }));
        }
        // 監査ログの記録 (STAFF_UPDATE)
        let logDetails = `${regName.trim()}さんの職員情報を更新しました`;
        if (regStatus === '長期休暇') {
          if (leaveStart && leaveEnd) {
            logDetails = `${regName.trim()}さんのステータスを【長期休暇（${leaveStart} 〜 ${leaveEnd}）】に更新しました`;
          } else if (leaveStart) {
            logDetails = `${regName.trim()}さんのステータスを【長期休暇（${leaveStart} 〜）】に更新しました`;
          } else {
            logDetails = `${regName.trim()}さんのステータスを【長期休暇】に更新しました`;
          }
        } else if (editingStaff?.status && editingStaff.status !== regStatus) {
          logDetails = `${regName.trim()}さんのステータスを「${editingStaff.status}」から【${regStatus}】に更新しました`;
        } else {
          logDetails = `${regName.trim()}さんの職員情報（${regTitle} / ${regJobType} / ${regPlacement}）を更新しました`;
        }

        await recordAuditLog({
          operatorId: profile?.id,
          operatorName: profile?.name || '管理者',
          targetStaffId: editingStaff.id,
          targetStaffName: regName.trim(),
          actionType: 'STAFF_UPDATE',
          details: logDetails,
          beforeData: editingStaff,
          afterData: { ...editingStaff, ...payload },
        });

        await fetchStaff();
        if (props.fetchShifts) {
          try { await props.fetchShifts(); } catch (e) { console.warn('fetchShifts error:', e); }
        }
        if (props.onForceCloudSync) {
          try { await props.onForceCloudSync(); } catch (e) { console.warn('onForceCloudSync error:', e); }
        }
        setTimeout(() => { 
          setStatusMsg(''); 
          setIsRegistrationModalVisible(false);
          setEditingStaff(null);
        }, 1000);
      }
    } catch (error: any) {
      console.error("UPDATE ERROR:", error);
      setStatusMsg("❌ エラー: " + (error.message || "不明なエラー"));
    } finally {
      setIsSaving(false);
    }
  };

  // 3. パスワード強制変更 (Auth.users 即時更新)
  const handleChangePassword = async () => {
    if (!newPasswordInput.trim() || newPasswordInput.trim().length < 6) {
      setPasswordChangeMsg('❌ パスワードは6文字以上で入力してください');
      return;
    }

    if (!editingStaff) return;

    setIsChangingPassword(true);
    setPasswordChangeMsg('変更中...');

    try {
      await updateStaffPasswordApi(editingStaff.id, newPasswordInput.trim(), editingStaff.user_id);
      setPasswordChangeMsg('✅ パスワードを変更しました！');
      setNewPasswordInput('');
      Alert.alert('完了', `${editingStaff.name} さんのログインパスワードを変更しました。`);
    } catch (err: any) {
      console.error('Password change error:', err);
      setPasswordChangeMsg(`❌ エラー: ${err.message || 'パスワード変更に失敗しました'}`);
    } finally {
      setIsChangingPassword(false);
    }
  };

  // 4. スタッフの無効化または完全削除（Web & Native 完全対応）
  const handleDeleteStaff = async (permanent: boolean = false) => {
    if (!editingStaff) return;

    const targetId = editingStaff.id || editingStaff.user_id;
    if (!targetId) {
      if (Platform.OS === 'web') {
        window.alert('エラー: 対象スタッフのIDが取得できませんでした。');
      } else {
        Alert.alert('エラー', '対象スタッフのIDが取得できませんでした。');
      }
      return;
    }

    // 管理者自身の保護
    if (
      editingStaff.id === profile?.id ||
      editingStaff.email === profile?.email ||
      editingStaff.user_id === profile?.id
    ) {
      const selfMsg = '現在ログイン中の管理者自身を削除・無効化することはできません。';
      if (Platform.OS === 'web') {
        window.alert(selfMsg);
      } else {
        Alert.alert('操作不可', selfMsg);
      }
      return;
    }

    const actionText = permanent ? '完全削除（物理削除）' : '無効化（ログイン停止）';
    const confirmMessage = `${editingStaff.name} さんを${actionText}しますか？\n\n${
      permanent
        ? '【警告】この操作は取り消せません。Authアカウントおよびスタッフデータが完全に削除されます。'
        : '※過去のシフト履歴は保持されたまま、ログイン認証が停止されます。'
    }`;

    const executeDelete = async () => {
      setIsSaving(true);
      try {
        console.log('📡 削除/無効化リクエスト送信:', {
          targetId,
          permanent,
          userId: editingStaff.user_id,
        });
        await deleteStaffApi(targetId, permanent, editingStaff.user_id);

        const successMsg = `${editingStaff.name} さんの${actionText}が完了しました。`;
        if (Platform.OS === 'web') {
          window.alert(successMsg);
        } else {
          Alert.alert('完了', successMsg);
        }

        await fetchStaff();
        setIsRegistrationModalVisible(false);
        setEditingStaff(null);
      } catch (err: any) {
        console.error('削除エラー:', err);
        const errMsg = err.message || `${actionText}に失敗しました。`;
        if (Platform.OS === 'web') {
          window.alert(`エラー: ${errMsg}`);
        } else {
          Alert.alert('エラー', errMsg);
        }
      } finally {
        setIsSaving(false);
      }
    };

    // Web 環境の場合は window.confirm を使用
    if (Platform.OS === 'web') {
      if (window.confirm(confirmMessage)) {
        await executeDelete();
      }
    } else {
      Alert.alert(
        `${actionText}の確認`,
        confirmMessage,
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: permanent ? '完全に削除する' : '無効化する',
            style: 'destructive',
            onPress: executeDelete,
          },
        ]
      );
    }
  };

  const handleDeactivateStaff = () => handleDeleteStaff(false);
  const handlePermanentDeleteStaff = () => handleDeleteStaff(true);

  // Constants
  const SHIFT_TYPES = ['出勤', '公休', '夏季休暇', '時間休', '振替＋時間休', '1日振替', '半日振替', '特休', '年休', '特休＋時間休', '出張', '休日時間外', '空欄'];
  const HOUR_SELECTOR_TYPES = ['時間休', '特休', '特休＋時間休', '振替＋時間休', '出張', '休日時間外'];

  const monthInfo = useMemo(() => (getMonthInfo(activeDate.getFullYear(), activeDate.getMonth()) || []) as MonthDay[], [activeDate]);
  
  const filteredStaff = useMemo(() => {
  // ✨ Supabaseから直接取ってきた、正しいUUID（id）を保持している debugStaffList を使って一覧を作ります
      if (!Array.isArray(debugStaffList)) return [];
      return [...debugStaffList.filter(s => s)].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }, [debugStaffList]); // 💡 監視対象も debugStaffList に変更

  const normalize = (n: string) => (n || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/公費/g, '').toUpperCase();

  const getReqHours = (r: any): number => {
    if (!r) return 0;
    
    // [STRICT REFACTOR] 常に専用の hours カラムを最優先する
    const h = r.hours;
    const parsedH = parseFloat(String(h));
    
    // [V76.0] ユーザー指示: 0時間として記録されている場合でも、特定の休暇タイプなら7.75時間をデフォルトとする
    const rType = (r.type || '').trim();
    const isFullDayLeaveType = ['年休', '有給休暇', '夏季休暇', '特休', '全休', '休暇', '欠勤', '年給', '有給', '1日振替'].includes(rType);
    
    if (h !== undefined && h !== null && h !== '' && !isNaN(parsedH)) {
      if (parsedH === 0 && isFullDayLeaveType) return 7.75;
      return parsedH;
    }
    
    // Default values by type (fallback)
    if (r.type === '1日振替') return 7.75;
    if (r.type === '半日振替') return 3.75;
    if (isFullDayLeaveType) return 7.75;
    if (rType === '午前休') return 4.0;
    if (rType === '午後休') return 3.75;
    
    return 0;
  };

  const requestMap = useMemo(() => {
    const map = new Map<string, Map<string, any>>();
    
    const normalizeLocal = (n: string) => (n || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/公費/g, '').toUpperCase();
    const extractUuid = (idStr: string): string | null => {
      if (!idStr) return null;
      const parts = idStr.split('-');
      return parts.length >= 6 ? parts.slice(1, 6).join('-') : null;
    };
    const allData = [...(Array.isArray(requests) ? requests : []), ...(Array.isArray(shifts) ? shifts : [])];
    
    allData.forEach(r => {
      if (!r || !r.date || r.status === 'deleted') return;
      
      const dateKey = normalizeDateStr(r.date);
      if (!map.has(dateKey)) map.set(dateKey, new Map<string, any>());
      const dayMap = map.get(dateKey)!;
      
      // [V57.6] 照合キーを ID 優先にするが、IDの揺れ（staff_id vs user_id）に備え名前でも保持
      const extractedId = extractUuid(r.id);
      const sId = String(r.staff_id || r.staffId || r.user_id || extractedId || '').trim();
      const sName = normalizeLocal(r.staffName || r.staff_name || '');
      
      const keys = [sId, sName].filter(Boolean);
      keys.forEach(key => {
        const existing = dayMap.get(key);
        
        const isManualEntry = (rec: any) => {
          if (!rec) return false;
          if (rec.is_manual === true || rec.isManual === true || rec.details?.isManual === true) return true;
          if (rec.is_manual === false || rec.isManual === false || rec.details?.isManual === false || rec.details?.isAuto === true) return false;
          const idStr = String(rec.id || '');
          return idStr.startsWith('m-') || idStr.startsWith('req-');
        };

        let isBetter = false;
        if (!existing) {
          isBetter = true;
        } else {
          const isManNew = isManualEntry(r);
          const wasManOld = isManualEntry(existing);

          if (isManNew && !wasManOld) {
            isBetter = true; // 手動は常に自動を上書き
          } else if (!isManNew && wasManOld) {
            isBetter = false; // 自動は手動を上書きできない
          } else if (isManNew && wasManOld) {
            // 共に手動の場合は時間が新しい方を優先
            const getTime = (i: any) => {
              const t = i?.updatedAt || i?.updated_at || i?.createdAt || i?.created_at || 0;
              return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
            };
            isBetter = getTime(r) > getTime(existing);
          } else {
            // 共に自動（または手動フラグが無い）場合は、休みを優先
            isBetter = (!['出勤', '日勤'].includes(r?.type) && ['出勤', '日勤'].includes(existing?.type));
          }
        }
          
        if (isBetter) {
          dayMap.set(key, r);
        }
      });
    });
    return map;
  }, [requests, shifts, normalize]);

  const handleDayPress = (d: MonthDay) => {
    if (!d || d.empty) return;
    setSelectedDay(d.dateStr);
    const sId = String(selectedStaff?.id || '').trim();
    const sName = normalize(selectedStaff?.name || '');
    const emailPrefix = selectedStaff?.email ? selectedStaff.email.split('@')[0].toUpperCase() : null;
    const dayMap = requestMap.get(d.dateStr);
    
    const rId = sId ? dayMap?.get(sId) : null;
    const rName = sName ? dayMap?.get(sName) : null;
    const rEmail = emailPrefix ? dayMap?.get(emailPrefix) : null;
    const potentialReqs = [rId, rName, rEmail].filter(Boolean);
    const existing = potentialReqs.find(r => !['出勤', '日勤'].includes(r.type)) || potentialReqs[0];
    if (existing) {
      setSelectedType((existing.type === '日勤' || existing.type === '出勤') ? '出勤' : existing.type);
      setSelectedHours(getReqHours(existing) || 1.0);
      setSpecialHours(existing.details?.specialHours || 1.0);
      setHourlyHours(existing.details?.hourlyHours || (existing.type === '振替＋時間休' && existing.hours ? Math.max(0.25, existing.hours - 4.0) : 1.0));
    } else {
      setSelectedType('出勤');
      setSelectedHours(1.0);
      setSpecialHours(1.0);
      setHourlyHours(1.0);
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
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        staffId: selectedStaff.id,
        staff_id: selectedStaff.id,
        staffName: selectedStaff.name,
        date: selectedDay,
        type: type,
        hours: type === '特休＋時間休'
          ? (specialHours + hourlyHours)
          : type === '振替＋時間休'
            ? (4.0 + hourlyHours)
            : (HOUR_SELECTOR_TYPES.includes(type) ? selectedHours : null),
        details: type === '特休＋時間休'
          ? { note: '管理画面より更新', specialHours, hourlyHours, isManual: true }
          : type === '振替＋時間休'
            ? { note: '管理画面より更新', furikaeHours: 4.0, hourlyHours, isManual: true }
            : { note: '管理画面より更新', isManual: true },
        status: 'approved',
        createdAt: now,
        updatedAt: now, 
        isShift: true,
        isManual: true,
        is_manual: true 
      };
      
      const sT = normalize(selectedStaff.name);
      const emailPrefix = selectedStaff.email ? selectedStaff.email.split('@')[0].toUpperCase() : null;
      setRequests((prev: any[]) => {
        const without = prev.filter((r: any) => r && !( 
          (String(r.staffId) === selectedStaff.id || normalize(r.staffName || r.staff_name) === sT || (emailPrefix && normalize(r.staffName || r.staff_name) === emailPrefix)) 
          && r.date === selectedDay 
        ));
        return [newReq, ...without];
      });
      
      // [V75.2] CORRECT SAVE LOGIC: Use cloudStorage directly
      await cloudStorage.upsertRequestsAndShifts([newReq]);
      
      // 監査ログの記録
      await recordAuditLog({
        operatorId: profile?.id,
        operatorName: profile?.name || '管理者',
        targetStaffId: selectedStaff.id,
        targetStaffName: selectedStaff.name,
        actionType: 'SHIFT_UPDATE',
        targetDate: selectedDay,
        details: `${selectedStaff.name}さんの予定（${selectedDay}）を「${type}」に設定しました${newReq.hours ? ` (${newReq.hours}h)` : ''}`,
        afterData: newReq
      });

      if (fetchShifts) {
        await fetchShifts(); // 表示を最新の状態に更新
      }
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
    const emailPrefix = selectedStaff.email ? selectedStaff.email.split('@')[0].toUpperCase() : null;
    const existing = requests.filter((r: any) => r && ( 
      (String(r.staffId) === selectedStaff.id || normalize(r.staffName || r.staff_name) === sT || (emailPrefix && normalize(r.staffName || r.staff_name) === emailPrefix)) 
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
        
        // [V53.3] shiftsテーブルからも削除
        if (selectedStaff?.id) {
          const cleanStaffId = String(selectedStaff.id).trim();
          await supabase.from('shifts').delete()
            .eq('staff_id', cleanStaffId)
            .eq('date', selectedDay);
        }
        
        // 監査ログの記録
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

        await fetchShifts();
        
        // Instead of setting selectedDay to null and closing everything, just update the state
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
  };

  const handlePrint = () => {
    if (Platform.OS !== 'web' || !selectedStaff) return;
    
    try {
      const year = activeDate.getFullYear();
      const month = activeDate.getMonth() + 1;
      const sId = String(selectedStaff.id || '').trim();
      const sName = normalize(selectedStaff.name);
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
  };

  const renderCalendar = () => {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    
    // 1週間（7日）ごとの行に分割する
    const rows: MonthDay[][] = [];
    let currentRow: MonthDay[] = [];
    
    monthInfo.forEach((d, i) => {
      currentRow.push(d);
      if (currentRow.length === 7 || i === monthInfo.length - 1) {
        // 7日分たまったか、最後の日なら行を追加
        while (currentRow.length < 7) {
          currentRow.push({ day: 0, dateStr: `empty-${i}-${currentRow.length}`, empty: true, isH: false });
        }
        rows.push(currentRow);
        currentRow = [];
      }
    });

    return (
      <View style={styles.calendarContainer}>
        {/* 曜日ヘッダー */}
        <View style={styles.calendarRow}>
          {days.map(d => (
            <View key={d} style={styles.calendarHeaderCell}>
              <ThemeText variant="caption" color={COLORS.textSecondary} style={{ fontSize: 12 }}>{d}</ThemeText>
            </View>
          ))}
        </View>

        {/* 日付グリッド */}
        {rows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.calendarRow}>
            {row.map((d, colIndex) => {
              if (!d || d.empty) {
                return <View key={`empty-${rowIndex}-${colIndex}`} style={styles.calendarDayCell} />;
              }

              const isSelected = selectedDay === d.dateStr;
              const sId = String(selectedStaff?.id || '').trim();
              const sName = normalize(selectedStaff?.name || '');
              const emailPrefix = selectedStaff?.email ? selectedStaff.email.split('@')[0].toUpperCase() : null;
              const dayMap = requestMap.get(d.dateStr);
              
              const rId = sId ? dayMap?.get(sId) : null;
              const rName = sName ? dayMap?.get(sName) : null;
              const rEmail = emailPrefix ? dayMap?.get(emailPrefix) : null;
              const potentialReqs = [rId, rName, rEmail].filter(Boolean);
              const req = potentialReqs.find(r => !['出勤', '日勤'].includes(r.type)) || potentialReqs[0];
              
              let displayLabel = '';
              let labelColor = 'white';
              if (req) {
                const h = getReqHours(req);
                const rType = (req.type || '').trim();
                if (['出勤', '日勤'].includes(rType)) {
                  displayLabel = '出勤'; labelColor = '#38bdf8';
                } else if (rType === '公休') {
                  displayLabel = '公休'; labelColor = '#ef4444';
                } else if (rType === '夏季休暇') {
                  displayLabel = '夏季'; labelColor = '#ef4444';
                } else if (['年休', '有給休暇', '年給', '有給'].includes(rType)) {
                  displayLabel = '年休'; labelColor = '#ef4444';
                } else if (rType === '1日振替') {
                  displayLabel = '振(全)'; labelColor = '#ef4444';
                } else if (rType === '半日振替') {
                  displayLabel = '振(半)'; labelColor = '#ef4444';
                } else if (rType === '特休＋時間休') {
                  const sp = req.details?.specialHours ?? 0;
                  const hr = req.details?.hourlyHours ?? 0;
                  displayLabel = `特${sp}+${hr}`; labelColor = '#ef4444';
                } else if (rType === '出張') {
                  displayLabel = `出張(${h}h)`; labelColor = '#f97316';
                } else if (rType === '振替＋時間休') {
                  const hr = req.details?.hourlyHours ?? (req.hours ? Math.max(0, req.hours - 4) : 0);
                  displayLabel = hr > 0 ? `振+時${hr}` : '振＋時'; labelColor = '#ef4444';
                } else if (rType === '休日時間外') {
                  displayLabel = `休外(${h}h)`; labelColor = '#38bdf8';
                } else if (['時間休', '時間給', '特休', '午前休', '午後休', '看護休暇'].includes(rType)) {
                  displayLabel = `${rType.charAt(0)}(${h}h)`; labelColor = '#ef4444';
                } else {
                  displayLabel = rType.slice(0, 2);
                  if (['公休', '欠勤', '休暇', '全休'].includes(rType)) labelColor = '#ef4444';
                }
              } else {
                const dDate = new Date(d.dateStr);
                const dtype = getDayType(dDate);
                if (dtype === 'weekday') {
                  displayLabel = '出勤'; labelColor = '#38bdf8';
                } else {
                  displayLabel = '公休'; labelColor = '#ef4444';
                }
              }

              return (
                <TouchableOpacity 
                  key={d.dateStr} 
                  style={[styles.calendarDayCell, isSelected && styles.calendarDaySelected]} 
                  onPress={() => handleDayPress(d)}
                >
                  <ThemeText bold={isSelected} color={d.isH ? '#ef4444' : 'white'} style={{ fontSize: 13, marginBottom: 2 }}>{d.day}</ThemeText>
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
    const staffPos = staff.position || staff.role || '';
    const hoursPerDay = staffPos.includes('会計年度') ? 7.5 : 7.75;
    
    for (let day = 1; day <= daysInMonthCount; day++) {
      const date = new Date(year, month, day);
      const dateStr = getDateStr(date);
      
      const dayMap = requestMap.get(dateStr);
      const sId = String(staff.id || '').trim();
      const sT = normalize(staff.name);
      // [V72.8] メールアドレスの@より前（mitsui等）も検索キーに含めることで、英字名で保存された過去データとの紐付けを強化
      const emailPrefix = staff.email ? staff.email.split('@')[0].toUpperCase() : null;
      
      // [V72.9] 照合精度の向上：ID、名前、メールプレフィックスのいずれかで「休み」が見つかればそれを優先
      const rId = sId ? dayMap?.get(sId) : null;
      const rName = sT ? dayMap?.get(sT) : null;
      const rEmail = emailPrefix ? dayMap?.get(emailPrefix) : null;
      
      const potentialReqs = [rId, rName, rEmail].filter(Boolean);
      // 休み（出勤・日勤以外）のデータを優先的に探す
      const req = potentialReqs.find(r => !['出勤', '日勤'].includes(r.type)) || potentialReqs[0];
      
      if (req) {
        if (['出勤', '日勤'].includes(req.type)) {
          // 祝日出勤の判定: 詳細は明示的なフラグ(isHolidayWork)または曜日から判断
          const isHW = req.isHolidayWork || req.details?.isHolidayWork || (getDayType(date) !== 'weekday');
          if (!isHW) workDays++; else holidayWorkDays++;
        } else {
          const h = getReqHours(req);
          const rType = (req.type || '').trim();

          // 【特休・時間休対応】1日所定労働時間(7.75h/7.5h)に達しない短時間・一部休暇（一部特休等）は出勤日としてカウント
          if (h > 0 && h < hoursPerDay && !['公休', '1日振替'].includes(rType) && !rType.includes('全休')) {
            const isHW = req.isHolidayWork || req.details?.isHolidayWork || (getDayType(date) !== 'weekday');
            if (!isHW) workDays++; else holidayWorkDays++;
          }

          // [V72.7] 「公休」「振替」を除外（ただし振替＋時間休の時間休部分は休暇時間として加算）
          if (rType === '振替＋時間休') {
            const hr = req.details?.hourlyHours ?? (req.hours ? Math.max(0, req.hours - 4) : 0);
            leaveHours += hr;
            continue;
          }

          if (req.type.includes('振替') || req.type.includes('振休') || req.type === '公休') {
            continue;
          }

          // 休暇時間としてカウントする種別を限定
          const holidayTypes = ['年休', '有給休暇', '夏季休暇', '特休', '時間休', '時間給', '午前休', '午後休', '看護休暇', '年給', '有給', '特休＋時間休'];
          if (holidayTypes.includes(rType)) {
            leaveHours += h;
          }
        }
      } else {
        // デフォルトロジック：平日は出勤、休日は公休（カウントなし）
        const dtype = getDayType(date);
        if (dtype === 'weekday') {
          workDays++;
        }
      }
    }
    return { workDays, holidayWorkDays, leaveHours: leaveHours.toFixed(2) };
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <ThemeText variant="h1">職員一覧</ThemeText>
            <ThemeText variant="caption">職員の出勤状況・管理</ThemeText>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            {isAdminAuthenticated && (
              <TouchableOpacity
                style={styles.addStaffHeaderBtn}
                onPress={handleOpenNewStaffModal}
              >
                <UserPlus size={18} color="white" />
                <ThemeText bold color="white" style={{ fontSize: 13, marginLeft: 6 }}>
                  新規スタッフ登録
                </ThemeText>
              </TouchableOpacity>
            )}
            <TouchableOpacity 
              style={{ padding: 8 }} 
              onPress={() => props.onLogout ? props.onLogout() : supabase.auth.signOut()}
            >
              <LogOut size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* --- [CLEANUP] DEBUG RENDER AREA REMOVED --- */}

      <ScrollView 
        style={{ flex: 1, width: '100%' }} 
        contentContainerStyle={{ 
          paddingHorizontal: SPACING.md, 
          paddingBottom: 100,
          width: '100%',
          alignItems: 'stretch'
        }}
      >
        <View style={[styles.staffGrid, { width: '100%', alignSelf: 'stretch' }]}>
          {(filteredStaff || []).map(staff => {
            if (!staff) return null;
            const isInactive = staff?.status === '無効';
            const stats = calculateStats(staff);
            const todayStr = getDateStr(new Date());
            const lStart = (staff?.leave_start_date || staff?.leaveStartDate || (typeof window !== 'undefined' ? (localStorage.getItem(`leave_start_date_${staff?.id}`) || localStorage.getItem(`leave_start_date_${staff?.email}`) || localStorage.getItem(`leave_start_date_${staff?.name}`)) : null) || '').trim();
            const lEnd = (staff?.leave_end_date || staff?.leaveEndDate || (typeof window !== 'undefined' ? (localStorage.getItem(`leave_end_date_${staff?.id}`) || localStorage.getItem(`leave_end_date_${staff?.email}`) || localStorage.getItem(`leave_end_date_${staff?.name}`)) : null) || '').trim();

            const hasStartDate = !!lStart;
            const hasEndDate = !!lEnd;

            let isLongTerm = false;
            if (staff?.status === '長期休暇') {
              if (hasStartDate && hasEndDate) {
                isLongTerm = lStart <= todayStr && todayStr <= lEnd;
              } else if (hasStartDate) {
                isLongTerm = lStart <= todayStr;
              } else if (hasEndDate) {
                isLongTerm = todayStr <= lEnd;
              } else {
                isLongTerm = true;
              }
            }
            return (
              <ThemeCard key={staff.id} style={[styles.staffCard, isLongTerm && { opacity: 0.6 }, isInactive && { opacity: 0.45, borderColor: '#ef4444' }]}>
                <View style={styles.cardHeader}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                      <ThemeText bold variant="h2" style={{ marginRight: 8, color: isInactive ? '#94a3b8' : 'white' }}>{staff?.name || '無名'}</ThemeText>
                      {(staff?.role || staff?.position) ? (
                        <View style={styles.badge}>
                          <ThemeText style={styles.badgeText}>{staff?.role || staff?.position}</ThemeText>
                        </View>
                      ) : null}
                      {isInactive && (
                        <View style={[styles.badge, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}>
                          <ThemeText style={[styles.badgeText, { color: '#ef4444' }]}>無効（停止中）</ThemeText>
                        </View>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', marginTop: 4, gap: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Briefcase size={12} color={COLORS.textSecondary} />
                        <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 4 }}>{staff?.jobType || staff?.profession || ''}</ThemeText>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <MapPin size={12} color={COLORS.textSecondary} />
                        <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 4 }}>{staff?.placement || staff?.department || ''}</ThemeText>
                      </View>
                      {staff?.email ? (
                        <ThemeText variant="caption" color="rgba(255,255,255,0.4)" style={{ fontSize: 10 }}>
                          {staff.email}
                        </ThemeText>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                  {userRole === 'admin' && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={[styles.miniBtn, { backgroundColor: 'rgba(56, 189, 248, 0.1)' }]} onPress={() => handleOpenRegistration(staff)}>
                        <Pencil size={18} color="#38bdf8" />
                      </TouchableOpacity>
                    </View>
                  )}
                  <TouchableOpacity style={styles.miniBtn} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}>
                    <Calendar size={18} color="#38bdf8" />
                  </TouchableOpacity>
                </View>
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}><ThemeText variant="caption" color={COLORS.textSecondary}>平日</ThemeText><ThemeText bold>{stats?.workDays || 0}日</ThemeText></View>
                  <View style={styles.statBox}><ThemeText variant="caption" color={COLORS.textSecondary}>休出</ThemeText><ThemeText bold color="#f87171">{stats?.holidayWorkDays || 0}日</ThemeText></View>
                  <View style={styles.statBox}>
                    <ThemeText variant="caption" color={COLORS.textSecondary}>残年休</ThemeText>
                    <ThemeText bold color="#38bdf8">
                      {(() => {
                        const getStaffInitDays = () => {
                          const uKey1 = `initial_leave_days_${staff?.id}`;
                          const uKey2 = `initial_leave_days_${staff?.email}`;
                          const uKey3 = `initial_leave_days_${staff?.name}`;
                          if (typeof window !== 'undefined') {
                            const s1 = localStorage.getItem(uKey1);
                            const s2 = localStorage.getItem(uKey2);
                            const s3 = localStorage.getItem(uKey3);
                            if (s1 !== null && !isNaN(parseFloat(s1))) return parseFloat(s1);
                            if (s2 !== null && !isNaN(parseFloat(s2))) return parseFloat(s2);
                            if (s3 !== null && !isNaN(parseFloat(s3))) return parseFloat(s3);
                          }
                          return Number(staff?.initial_leave_days ?? staff?.initialLeaveDays ?? 20);
                        };
                        const staffPos = staff?.position || staff?.role || '';
                        const initLeaveDays = getStaffInitDays();
                        const allCalendarData = [...(Array.isArray(requests) ? requests : []), ...(Array.isArray(shifts) ? shifts : [])];
                        const remLeaveHours = calculateRemainingLeaveHours(initLeaveDays, allCalendarData, staff);
                        return formatRemainingLeave(remLeaveHours, staffPos);
                      })()}
                    </ThemeText>
                  </View>
                  <View style={styles.statBox}>
                    <ThemeText variant="caption" color={COLORS.textSecondary}>5日必修</ThemeText>
                    {(() => {
                      const allCalendarData = [...(Array.isArray(requests) ? requests : []), ...(Array.isArray(shifts) ? shifts : [])];
                      const mStatus = calculateMandatoryLeaveStatus(staff, allCalendarData, activeDate.getFullYear());
                      return (
                        <ThemeText bold color={mStatus.isCompleted ? '#10b981' : '#f59e0b'} style={{ fontSize: 11 }}>
                          {mStatus.displayText}
                        </ThemeText>
                      );
                    })()}
                  </View>
                </View>
              </ThemeCard>
            );
          })}
        </View>
      </ScrollView>
      
      {/* Calendar Modal */}
      <Modal visible={isCalendarModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.calendarModal}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemeText variant="h2">{selectedStaff?.name || ''}</ThemeText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>{activeDate.getFullYear()}年 {activeDate.getMonth() + 1}月</ThemeText>
                  {selectedStaff && (
                    <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                      <ThemeText variant="caption" color="#38bdf8" bold>休暇合計: {calculateStats(selectedStaff).leaveHours}h</ThemeText>
                    </View>
                  )}
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                {Platform.OS === 'web' && ( <TouchableOpacity onPress={handlePrint} style={styles.iconBtn}><Printer size={22} color="#38bdf8" /></TouchableOpacity> )}
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
                      {selectedType === '特休＋時間休' ? (
                        <View style={{ gap: 16 }}>
                          <View>
                            <ThemeText variant="caption" style={{ marginBottom: 6 }}>特休の時間数</ThemeText>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                              <TouchableOpacity onPress={() => setSpecialHours(prev => Math.max(0.25, prev - 0.25))} style={styles.adjustBtn}>
                                <ThemeText bold>-</ThemeText>
                              </TouchableOpacity>
                              <ThemeText variant="h2" color={COLORS.primary}>{specialHours.toFixed(2)}h</ThemeText>
                              <TouchableOpacity onPress={() => setSpecialHours(prev => Math.min(8.0, prev + 0.25))} style={styles.adjustBtn}>
                                <ThemeText bold>+</ThemeText>
                              </TouchableOpacity>
                            </View>
                          </View>
                          <View>
                            <ThemeText variant="caption" style={{ marginBottom: 6 }}>時間休の時間数</ThemeText>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                              <TouchableOpacity onPress={() => setHourlyHours(prev => Math.max(0.25, prev - 0.25))} style={styles.adjustBtn}>
                                <ThemeText bold>-</ThemeText>
                              </TouchableOpacity>
                              <ThemeText variant="h2" color={COLORS.primary}>{hourlyHours.toFixed(2)}h</ThemeText>
                              <TouchableOpacity onPress={() => setHourlyHours(prev => Math.min(8.0, prev + 0.25))} style={styles.adjustBtn}>
                                <ThemeText bold>+</ThemeText>
                              </TouchableOpacity>
                            </View>
                          </View>
                          <ThemeText variant="caption" bold style={{ marginTop: 4 }}>合計時間: {(specialHours + hourlyHours).toFixed(2)}h</ThemeText>
                        </View>
                      ) : selectedType === '振替＋時間休' ? (
                        <View style={{ gap: 12 }}>
                          <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.12)', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                            <ThemeText variant="caption" color={COLORS.primary} bold>
                              ※ 振替4時間 ＋ 時間休 {hourlyHours.toFixed(2)}時間（合計: {(4.0 + hourlyHours).toFixed(2)}h）
                            </ThemeText>
                            <ThemeText variant="caption" style={{ color: COLORS.textSecondary, fontSize: 11, marginTop: 2 }}>
                              ※ 時間休 {hourlyHours.toFixed(2)}h が年休から消化されます
                            </ThemeText>
                          </View>

                          <View>
                            <ThemeText variant="caption" style={{ marginBottom: 6 }}>時間休の時間数を選択</ThemeText>
                            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                              {[1.0, 2.0, 3.0, 3.5, 3.75].map((preset) => (
                                <TouchableOpacity
                                  key={preset}
                                  style={[
                                    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.05)' },
                                    hourlyHours === preset && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
                                  ]}
                                  onPress={() => setHourlyHours(preset)}
                                >
                                  <ThemeText variant="caption" bold={hourlyHours === preset} color={hourlyHours === preset ? 'white' : COLORS.text}>
                                    {preset}h
                                  </ThemeText>
                                </TouchableOpacity>
                              ))}
                            </View>

                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                              <TouchableOpacity onPress={() => setHourlyHours(prev => Math.max(0.25, prev - 0.25))} style={styles.adjustBtn}>
                                <ThemeText bold>-</ThemeText>
                              </TouchableOpacity>
                              <ThemeText variant="h2" color={COLORS.primary}>{hourlyHours.toFixed(2)}h</ThemeText>
                              <TouchableOpacity onPress={() => setHourlyHours(prev => Math.min(8.0, prev + 0.25))} style={styles.adjustBtn}>
                                <ThemeText bold>+</ThemeText>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                          <TouchableOpacity onPress={() => setSelectedHours(Math.max(0.25, selectedHours - 0.25))} style={styles.adjustBtn}>
                            <ThemeText bold>-</ThemeText>
                          </TouchableOpacity>
                          <ThemeText variant="h2" color={COLORS.primary}>{selectedHours.toFixed(2)}h</ThemeText>
                          <TouchableOpacity onPress={() => setSelectedHours(Math.min(8.0, selectedHours + 0.25))} style={styles.adjustBtn}>
                            <ThemeText bold>+</ThemeText>
                          </TouchableOpacity>
                        </View>
                      )}
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

      {/* ==================================================== */}
      {/* 1. 新規スタッフ登録モーダル (管理者専用) */}
      {/* ==================================================== */}
      {isNewStaffModalVisible && (
        <View style={styles.customModalOverlay}>
          <View style={styles.customModalBox}>
            <View style={styles.customModalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <UserPlus size={22} color="#38bdf8" />
                  <ThemeText variant="h2">新規スタッフ登録</ThemeText>
                </View>
                <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginTop: 2 }}>
                  Auth 認証アカウントと Staff テーブルを同時に作成します
                </ThemeText>
              </View>
              <TouchableOpacity onPress={() => setIsNewStaffModalVisible(false)} style={styles.closeBtn}>
                <X size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={{ paddingVertical: 10 }}>
                {newStaffStatusMsg ? (
                  <View style={[styles.statusMsgBox, newStaffStatusMsg.includes('❌') ? styles.statusMsgError : styles.statusMsgSuccess]}>
                    <ThemeText bold style={{ color: newStaffStatusMsg.includes('❌') ? '#ef4444' : '#10b981', textAlign: 'center' }}>
                      {newStaffStatusMsg}
                    </ThemeText>
                  </View>
                ) : null}

                <ThemeText variant="label" style={{ marginBottom: 6 }}>氏名 <ThemeText color="#ef4444">*</ThemeText></ThemeText>
                <TextInput
                  style={styles.input}
                  placeholder="例: 山田 太郎"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={newName}
                  onChangeText={setNewName}
                />

                <ThemeText variant="label" style={{ marginBottom: 6, marginTop: 14 }}>メールアドレス（ログインID） <ThemeText color="#ef4444">*</ThemeText></ThemeText>
                <TextInput
                  style={styles.input}
                  placeholder="例: yamada@reha.local"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={newEmail}
                  onChangeText={setNewEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />

                <ThemeText variant="label" style={{ marginBottom: 6, marginTop: 14 }}>初期パスワード（6文字以上） <ThemeText color="#ef4444">*</ThemeText></ThemeText>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={[styles.input, { flex: 1, borderWidth: 0 }]}
                    placeholder="パスワードを入力"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showNewStaffPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={styles.eyeBtn}
                    onPress={() => setShowNewStaffPassword(!showNewStaffPassword)}
                  >
                    {showNewStaffPassword ? <EyeOff size={18} color={COLORS.textSecondary} /> : <Eye size={18} color={COLORS.textSecondary} />}
                  </TouchableOpacity>
                </View>

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>アプリ権限</ThemeText>
                <View style={styles.typeGrid}>
                  {APP_ROLES.map(r => (
                    <TouchableOpacity 
                      key={r} 
                      style={[styles.typeBtn, newAppRole === r && styles.typeBtnActive]} 
                      onPress={() => setNewAppRole(r)}
                    >
                      <ThemeText bold={newAppRole === r} color={newAppRole === r ? 'white' : COLORS.textSecondary}>{r}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>職種</ThemeText>
                <View style={styles.typeGrid}>
                  {JOB_TYPES.map(jt => (
                    <TouchableOpacity 
                      key={jt} 
                      style={[styles.typeBtn, newJobType === jt && styles.typeBtnActive]} 
                      onPress={() => setNewJobType(jt)}
                    >
                      <ThemeText bold={newJobType === jt} color={newJobType === jt ? 'white' : COLORS.textSecondary}>{jt}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>役職</ThemeText>
                <View style={styles.typeGrid}>
                  {TITLES.map(t => (
                    <TouchableOpacity 
                      key={t} 
                      style={[styles.typeBtn, newTitle === t && styles.typeBtnActive]} 
                      onPress={() => setNewTitle(t)}
                    >
                      <ThemeText bold={newTitle === t} color={newTitle === t ? 'white' : COLORS.textSecondary}>{t}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>配置</ThemeText>
                <View style={styles.typeGrid}>
                  {PLACEMENTS.map(p => (
                    <TouchableOpacity 
                      key={p} 
                      style={[styles.typeBtn, newPlacement === p && styles.typeBtnActive]} 
                      onPress={() => setNewPlacement(p)}
                    >
                      <ThemeText bold={newPlacement === p} color={newPlacement === p ? 'white' : COLORS.textSecondary}>{p}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>ステータス</ThemeText>
                <View style={styles.typeGrid}>
                  {STATUSES.filter(s => s !== '無効').map(s => (
                    <TouchableOpacity 
                      key={s} 
                      style={[styles.typeBtn, newStatus === s && styles.typeBtnActive]} 
                      onPress={() => setNewStatus(s)}
                    >
                      <ThemeText bold={newStatus === s} color={newStatus === s ? 'white' : COLORS.textSecondary}>{s}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemeText variant="label" style={{ marginBottom: 6, marginTop: 14 }}>付与年休数 (日数)</ThemeText>
                <TextInput
                  style={styles.input}
                  placeholder="例: 20"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={newInitialLeaveDays}
                  onChangeText={setNewInitialLeaveDays}
                  keyboardType="numeric"
                />

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>休日設定 (自動割当条件)</ThemeText>
                <TouchableOpacity 
                  style={styles.selectRowBtn}
                  onPress={() => setShowNewHolidayPicker(true)}
                >
                  <ThemeText color="white">{newHolidaySetting ? '土日祝休み' : '設定なし'}</ThemeText>
                  <ChevronRight size={20} color={COLORS.textSecondary} />
                </TouchableOpacity>

                <View style={{ marginTop: 24, marginBottom: 16 }}>
                  <TouchableOpacity 
                    style={[styles.primaryActionBtn, isCreatingStaff && { opacity: 0.7 }]} 
                    onPress={handleCreateStaff}
                    disabled={isCreatingStaff}
                  >
                    {isCreatingStaff ? (
                      <ActivityIndicator color="white" style={{ marginRight: 8 }} />
                    ) : (
                      <UserPlus size={18} color="white" style={{ marginRight: 8 }} />
                    )}
                    <ThemeText bold color="white">
                      {isCreatingStaff ? '登録中...' : 'スタッフを新規登録する'}
                    </ThemeText>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {/* ==================================================== */}
      {/* 2. 職員情報の編集モーダル (基本情報変更 + パスワード変更 + 削除/無効化) */}
      {/* ==================================================== */}
      {isRegistrationModalVisible && editingStaff && (
        <View style={styles.customModalOverlay}>
          <View style={styles.customModalBox}>
            <View style={styles.customModalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Pencil size={20} color="#38bdf8" />
                  <ThemeText variant="h2">職員情報の編集・管理</ThemeText>
                </View>
                <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginTop: 2 }}>
                  {`${editingStaff?.name || ''} さんの情報・アカウント設定`}
                </ThemeText>
              </View>
              <TouchableOpacity onPress={() => { setIsRegistrationModalVisible(false); setEditingStaff(null); }} style={styles.closeBtn}>
                <X size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={{ paddingVertical: 10 }}>
                {statusMsg ? (
                  <View style={[styles.statusMsgBox, statusMsg.includes('❌') ? styles.statusMsgError : styles.statusMsgSuccess]}>
                    <ThemeText bold style={{ color: statusMsg.includes('❌') ? '#ef4444' : '#10b981', textAlign: 'center' }}>
                      {statusMsg}
                    </ThemeText>
                  </View>
                ) : null}

                {/* --- セクション1: 基本情報 --- */}
                <ThemeText bold style={{ color: '#38bdf8', marginBottom: 12, fontSize: 15 }}>👤 基本情報（Auth & Staff 同期）</ThemeText>
                
                <ThemeText variant="label" style={{ marginBottom: 6 }}>氏名 <ThemeText color="#ef4444">*</ThemeText></ThemeText>
                <TextInput
                  style={styles.input}
                  placeholder="例: 山田 太郎"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={regName}
                  onChangeText={setRegName}
                />

                <ThemeText variant="label" style={{ marginBottom: 6, marginTop: 14 }}>メールアドレス（Auth ログインID） <ThemeText color="#ef4444">*</ThemeText></ThemeText>
                <TextInput
                  style={styles.input}
                  placeholder="例: yamada@example.com"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={regEmail}
                  onChangeText={setRegEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />

                <ThemeText variant="label" style={{ marginBottom: 6, marginTop: 14 }}>
                  {regTitle.includes('会計年度') ? '4月時点の付与年休数 (日数) (7.5h/日換算)' : '1月時点の付与年休数 (日数) (7.75h/日換算)'}
                </ThemeText>
                <TextInput
                  style={styles.input}
                  placeholder="例: 20"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={regInitialLeaveDays}
                  onChangeText={setRegInitialLeaveDays}
                  keyboardType="numeric"
                />

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>アプリ権限</ThemeText>
                <View style={styles.typeGrid}>
                  {APP_ROLES.map(r => (
                    <TouchableOpacity 
                      key={r} 
                      style={[styles.typeBtn, regAppRole === r && styles.typeBtnActive]} 
                      onPress={() => setRegAppRole(r)}
                    >
                      <ThemeText bold={regAppRole === r} color={regAppRole === r ? 'white' : COLORS.textSecondary}>{r}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>職種</ThemeText>
                <View style={styles.typeGrid}>
                  {JOB_TYPES.map(jt => (
                    <TouchableOpacity 
                      key={jt} 
                      style={[styles.typeBtn, regJobType === jt && styles.typeBtnActive]} 
                      onPress={() => setRegJobType(jt)}
                    >
                      <ThemeText bold={regJobType === jt} color={regJobType === jt ? 'white' : COLORS.textSecondary}>{jt}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>役職</ThemeText>
                <View style={styles.typeGrid}>
                  {TITLES.map(t => (
                    <TouchableOpacity 
                      key={t} 
                      style={[styles.typeBtn, regTitle === t && styles.typeBtnActive]} 
                      onPress={() => setRegTitle(t)}
                    >
                      <ThemeText bold={regTitle === t} color={regTitle === t ? 'white' : COLORS.textSecondary}>{t}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>配置</ThemeText>
                <View style={styles.typeGrid}>
                  {PLACEMENTS.map(p => (
                    <TouchableOpacity 
                      key={p} 
                      style={[styles.typeBtn, regPlacement === p && styles.typeBtnActive]} 
                      onPress={() => setRegPlacement(p)}
                    >
                      <ThemeText bold={regPlacement === p} color={regPlacement === p ? 'white' : COLORS.textSecondary}>{p}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>ステータス</ThemeText>
                <View style={styles.typeGrid}>
                  {STATUSES.map(s => (
                    <TouchableOpacity 
                      key={s} 
                      style={[styles.typeBtn, regStatus === s && styles.typeBtnActive]} 
                      onPress={() => setRegStatus(s)}
                    >
                      <ThemeText bold={regStatus === s} color={regStatus === s ? 'white' : COLORS.textSecondary}>{s}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>

                {regStatus === '長期休暇' && (
                  <View style={{ marginTop: 12, padding: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                    <ThemeText variant="label" style={{ marginBottom: 8, color: '#38bdf8' }}>長期休暇の期間指定</ThemeText>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginBottom: 4 }}>開始日</ThemeText>
                        {Platform.OS === 'web' ? (
                          <input
                            type="date"
                            value={regLeaveStartDate}
                            onChange={(e: any) => setRegLeaveStartDate(e.target.value)}
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              borderRadius: 8,
                              padding: '10px 12px',
                              color: '#ffffff',
                              fontSize: 14,
                              width: '100%',
                              boxSizing: 'border-box',
                              outline: 'none',
                              colorScheme: 'dark',
                              cursor: 'pointer',
                            }}
                          />
                        ) : (
                          <TouchableOpacity
                            style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12 }]}
                            onPress={() => {
                              const d = regLeaveStartDate ? new Date(regLeaveStartDate) : new Date();
                              setLeavePickerMonth(isNaN(d.getTime()) ? new Date() : d);
                              setActiveLeaveDatePicker('start');
                            }}
                          >
                            <ThemeText color={regLeaveStartDate ? 'white' : 'rgba(255,255,255,0.3)'}>
                              {regLeaveStartDate || '開始日を選択'}
                            </ThemeText>
                            <Calendar size={16} color={COLORS.textSecondary} />
                          </TouchableOpacity>
                        )}
                      </View>
                      <ThemeText color={COLORS.textSecondary} style={{ marginTop: 16 }}>〜</ThemeText>
                      <View style={{ flex: 1 }}>
                        <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginBottom: 4 }}>終了日</ThemeText>
                        {Platform.OS === 'web' ? (
                          <input
                            type="date"
                            value={regLeaveEndDate}
                            onChange={(e: any) => setRegLeaveEndDate(e.target.value)}
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              borderRadius: 8,
                              padding: '10px 12px',
                              color: '#ffffff',
                              fontSize: 14,
                              width: '100%',
                              boxSizing: 'border-box',
                              outline: 'none',
                              colorScheme: 'dark',
                              cursor: 'pointer',
                            }}
                          />
                        ) : (
                          <TouchableOpacity
                            style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12 }]}
                            onPress={() => {
                              const d = regLeaveEndDate ? new Date(regLeaveEndDate) : new Date();
                              setLeavePickerMonth(isNaN(d.getTime()) ? new Date() : d);
                              setActiveLeaveDatePicker('end');
                            }}
                          >
                            <ThemeText color={regLeaveEndDate ? 'white' : 'rgba(255,255,255,0.3)'}>
                              {regLeaveEndDate || '終了日を選択'}
                            </ThemeText>
                            <Calendar size={16} color={COLORS.textSecondary} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                )}

                <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 14 }}>休日設定 (自動割当条件)</ThemeText>
                <TouchableOpacity 
                  style={styles.selectRowBtn}
                  onPress={() => setShowHolidayPicker(true)}
                >
                  <ThemeText color="white">{regHolidaySetting ? '土日祝休み' : '設定なし'}</ThemeText>
                  <ChevronRight size={20} color={COLORS.textSecondary} />
                </TouchableOpacity>

                <View style={{ marginTop: 20, marginBottom: 24 }}>
                  <TouchableOpacity 
                    style={[styles.primaryActionBtn, isSaving && { opacity: 0.7 }]} 
                    onPress={handleRegisterStaff}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <ActivityIndicator color="white" style={{ marginRight: 8 }} />
                    ) : (
                      <Check size={20} color="white" style={{ marginRight: 8 }} />
                    )}
                    <ThemeText bold color="white">
                      {isSaving ? '保存中...' : '基本情報の変更を保存する'}
                    </ThemeText>
                  </TouchableOpacity>
                </View>

                {/* --- セクション2: パスワード強制変更 --- */}
                <View style={styles.subSectionBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Key size={18} color="#f59e0b" />
                    <ThemeText bold style={{ color: '#f59e0b', fontSize: 15 }}>🔐 パスワード強制変更</ThemeText>
                  </View>
                  <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginBottom: 12 }}>
                    新しいパスワードを入力して即座に変更できます（ログイン認証に即時反映）
                  </ThemeText>

                  {passwordChangeMsg ? (
                    <View style={[styles.statusMsgBox, passwordChangeMsg.includes('❌') ? styles.statusMsgError : styles.statusMsgSuccess, { marginBottom: 10 }]}>
                      <ThemeText bold style={{ color: passwordChangeMsg.includes('❌') ? '#ef4444' : '#10b981', textAlign: 'center' }}>
                        {passwordChangeMsg}
                      </ThemeText>
                    </View>
                  ) : null}

                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={[styles.input, { flex: 1, borderWidth: 0 }]}
                      placeholder="新しいパスワード（6文字以上）"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      value={newPasswordInput}
                      onChangeText={setNewPasswordInput}
                      secureTextEntry={!showNewPassword}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowNewPassword(!showNewPassword)}
                    >
                      {showNewPassword ? <EyeOff size={18} color={COLORS.textSecondary} /> : <Eye size={18} color={COLORS.textSecondary} />}
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.warningActionBtn, isChangingPassword && { opacity: 0.7 }, { marginTop: 12 }]}
                    onPress={handleChangePassword}
                    disabled={isChangingPassword}
                  >
                    {isChangingPassword ? (
                      <ActivityIndicator color="white" style={{ marginRight: 8 }} />
                    ) : (
                      <Key size={16} color="white" style={{ marginRight: 8 }} />
                    )}
                    <ThemeText bold color="white">
                      {isChangingPassword ? 'パスワード変更中...' : 'パスワードを変更する'}
                    </ThemeText>
                  </TouchableOpacity>
                </View>

                {/* --- セクション3: アカウント無効化・削除 --- */}
                <View style={[styles.subSectionBox, { borderColor: 'rgba(239, 68, 68, 0.3)', marginTop: 20 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <ShieldAlert size={18} color="#ef4444" />
                    <ThemeText bold style={{ color: '#ef4444', fontSize: 15 }}>⚠️ アカウント操作・削除</ThemeText>
                  </View>
                  <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginBottom: 16 }}>
                    退職や休職時のアクセス停止（無効化）、または不要になったアカウントの完全削除を行います。
                  </ThemeText>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      style={[styles.dangerOutlineBtn, { flex: 1 }]}
                      onPress={handleDeactivateStaff}
                      disabled={isSaving}
                    >
                      <UserX size={16} color="#f87171" style={{ marginRight: 6 }} />
                      <ThemeText bold color="#f87171" style={{ fontSize: 13 }}>
                        無効化（停止）
                      </ThemeText>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.dangerFillBtn, { flex: 1 }]}
                      onPress={handlePermanentDeleteStaff}
                      disabled={isSaving}
                    >
                      <Trash2 size={16} color="white" style={{ marginRight: 6 }} />
                      <ThemeText bold color="white" style={{ fontSize: 13 }}>
                        完全削除
                      </ThemeText>
                    </TouchableOpacity>
                  </View>
                </View>

              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {/* Holiday Setting Selection Modal (Edit Form) */}
      <Modal visible={showHolidayPicker} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: '85%', backgroundColor: '#0f172a', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <ThemeText variant="h2" style={{ marginBottom: 20 }}>休日設定 (自動割当条件)</ThemeText>
            
            <TouchableOpacity 
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }} 
              onPress={() => { setRegHolidaySetting(false); setShowHolidayPicker(false); }}
            >
              <ThemeText color={!regHolidaySetting ? '#38bdf8' : 'white'} style={{ fontSize: 18 }}>設定なし</ThemeText>
              {!regHolidaySetting && <Check size={20} color="#38bdf8" />}
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 }} 
              onPress={() => { setRegHolidaySetting(true); setShowHolidayPicker(false); }}
            >
              <ThemeText color={regHolidaySetting ? '#38bdf8' : 'white'} style={{ fontSize: 18 }}>土日祝休み</ThemeText>
              {regHolidaySetting && <Check size={20} color="#38bdf8" />}
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ marginTop: 24, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' }} 
              onPress={() => setShowHolidayPicker(false)}
            >
              <ThemeText bold>キャンセル</ThemeText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Holiday Setting Selection Modal (New Staff Form) */}
      <Modal visible={showNewHolidayPicker} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: '85%', backgroundColor: '#0f172a', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <ThemeText variant="h2" style={{ marginBottom: 20 }}>休日設定 (自動割当条件)</ThemeText>
            
            <TouchableOpacity 
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }} 
              onPress={() => { setNewHolidaySetting(false); setShowNewHolidayPicker(false); }}
            >
              <ThemeText color={!newHolidaySetting ? '#38bdf8' : 'white'} style={{ fontSize: 18 }}>設定なし</ThemeText>
              {!newHolidaySetting && <Check size={20} color="#38bdf8" />}
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 }} 
              onPress={() => { setNewHolidaySetting(true); setShowNewHolidayPicker(false); }}
            >
              <ThemeText color={newHolidaySetting ? '#38bdf8' : 'white'} style={{ fontSize: 18 }}>土日祝休み</ThemeText>
              {newHolidaySetting && <Check size={20} color="#38bdf8" />}
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ marginTop: 24, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' }} 
              onPress={() => setShowNewHolidayPicker(false)}
            >
              <ThemeText bold>キャンセル</ThemeText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Leave Date Picker Modal (Mobile Native Fallback) */}
      <Modal visible={!!activeLeaveDatePicker} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ width: '90%', maxWidth: 360, backgroundColor: '#0f172a', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <ThemeText variant="h2">
                {activeLeaveDatePicker === 'start' ? '休暇開始日を選択' : '休暇終了日を選択'}
              </ThemeText>
              <TouchableOpacity onPress={() => setActiveLeaveDatePicker(null)}>
                <X size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <TouchableOpacity 
                style={{ padding: 8 }} 
                onPress={() => setLeavePickerMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              >
                <ChevronLeft size={20} color="white" />
              </TouchableOpacity>
              <ThemeText bold variant="h2" style={{ fontSize: 16 }}>
                {`${leavePickerMonth.getFullYear()}年 ${leavePickerMonth.getMonth() + 1}月`}
              </ThemeText>
              <TouchableOpacity 
                style={{ padding: 8 }} 
                onPress={() => setLeavePickerMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              >
                <ChevronRight size={20} color="white" />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                <ThemeText 
                  key={d} 
                  style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 'bold', color: i === 0 ? '#ef4444' : i === 6 ? '#38bdf8' : COLORS.textSecondary }}
                >
                  {d}
                </ThemeText>
              ))}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {(getMonthInfo(leavePickerMonth.getFullYear(), leavePickerMonth.getMonth()) || []).map((d, idx) => {
                if (d.empty) {
                  return <View key={`empty-${idx}`} style={{ width: `${100 / 7}%`, height: 40 }} />;
                }
                const isSelected = activeLeaveDatePicker === 'start' 
                  ? regLeaveStartDate === d.dateStr 
                  : regLeaveEndDate === d.dateStr;
                return (
                  <TouchableOpacity
                    key={d.dateStr}
                    style={{
                      width: `${100 / 7}%`,
                      height: 40,
                      justifyContent: 'center',
                      alignItems: 'center',
                      borderRadius: 8,
                      backgroundColor: isSelected ? COLORS.primary : 'transparent',
                    }}
                    onPress={() => {
                      if (activeLeaveDatePicker === 'start') {
                        setRegLeaveStartDate(d.dateStr);
                      } else {
                        setRegLeaveEndDate(d.dateStr);
                      }
                      setActiveLeaveDatePicker(null);
                    }}
                  >
                    <ThemeText 
                      bold={isSelected} 
                      color={isSelected ? 'white' : d.isH ? '#ef4444' : 'white'}
                      style={{ fontSize: 13 }}
                    >
                      {d.day}
                    </ThemeText>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity 
                style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)', justifyContent: 'center', alignItems: 'center' }} 
                onPress={() => {
                  if (activeLeaveDatePicker === 'start') setRegLeaveStartDate('');
                  else setRegLeaveEndDate('');
                  setActiveLeaveDatePicker(null);
                }}
              >
                <ThemeText bold color="#f87171">クリア</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity 
                style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' }} 
                onPress={() => setActiveLeaveDatePicker(null)}
              >
                <ThemeText bold color="white">閉じる</ThemeText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    alignSelf: 'stretch',
    flexDirection: 'column'
  },
  header: { 
    padding: SPACING.md, 
    paddingTop: 10, 
    width: '100%', 
    maxWidth: '100%',
    alignItems: 'stretch',
    alignSelf: 'stretch'
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 14,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    width: '100%'
  },
  wardScroll: { paddingVertical: 10, width: '100%' },
  wardTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', marginRight: 8 },
  wardTabActive: { backgroundColor: '#38bdf8' },
  staffGrid: { gap: 12, width: '100%', alignItems: 'stretch' },
  staffCard: { padding: 16, borderRadius: 24, backgroundColor: 'rgba(30, 41, 59, 0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)', width: '100%', alignItems: 'stretch' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, width: '100%', alignItems: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(56, 189, 248, 0.15)', marginRight: 6, marginTop: 4 },
  badgeText: { fontSize: 10, color: '#38bdf8', fontWeight: 'bold' },
  miniBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(56, 189, 248, 0.1)', justifyContent: 'center', alignItems: 'center' },
  iconBtn: { padding: 8, backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: 10 },
  statsGrid: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 16, padding: 12, width: '100%' },
  statBox: { flex: 1, alignItems: 'center' },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.85)', 
    justifyContent: 'flex-end', 
    alignItems: 'stretch',
    width: '100%'
  },
  calendarModal: { 
    backgroundColor: '#0f172a', 
    borderTopLeftRadius: 28, 
    borderTopRightRadius: 28, 
    padding: 12, 
    paddingTop: 20,
    maxHeight: '92%',
    width: '100%',
    alignSelf: 'stretch'
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, width: '100%' },
  calendarNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, width: '100%' },
  calendarContainer: { width: '100%', marginBottom: 10 },
  calendarRow: { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
  calendarHeaderCell: { flex: 1, height: 30, justifyContent: 'center', alignItems: 'center' },
  calendarDayCell: { 
    flex: 1, 
    height: 68, 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderRadius: 12, 
    margin: 1,
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 0
  },
  calendarDaySelected: { backgroundColor: 'rgba(56, 189, 248, 0.2)', borderColor: '#38bdf8' },
  statusLabelContainer: { height: 18, justifyContent: 'center', alignItems: 'center' },
  statusLabel: { fontSize: 9, fontWeight: 'bold', textAlign: 'center' },
  editorSection: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 20 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  typeBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', minWidth: 80, alignItems: 'center' },
  typeBtnActive: { backgroundColor: '#38bdf8' },
  hBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  hBtnActive: { backgroundColor: '#38bdf8' },
  confirmBtn: { backgroundColor: '#38bdf8', padding: 16, borderRadius: 16, alignItems: 'center' },
  placeholderSection: { height: 100, justifyContent: 'center', alignItems: 'center' },
  adjustBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  deleteBtn: { borderWidth: 1, borderColor: '#ef4444', padding: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  
  // --- Admin Staff Management Specific Styles ---
  addStaffHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  customModalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 99999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  customModalBox: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '92%',
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
    flexDirection: 'column',
  },
  customModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    marginBottom: 10,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  statusMsgBox: {
    padding: 10,
    borderRadius: 10,
    marginBottom: 14,
    borderWidth: 1,
  },
  statusMsgSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  statusMsgError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingRight: 10,
  },
  eyeBtn: {
    padding: 8,
  },
  selectRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  primaryActionBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#0284c7',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  subSectionBox: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  warningActionBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#d97706',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  dangerOutlineBtn: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  dangerFillBtn: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
});
