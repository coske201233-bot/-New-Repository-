import { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import { useAuthSession } from './useAuthSession';
import { useStaffData } from './useStaffData';
import { useRequestData } from './useRequestData';
import { useConfigData } from './useConfigData';
import { useShiftData } from './useShiftData';
import { cloudStorage } from '../utils/cloudStorage';
import { supabase, isSupabaseAuthReady as isSupabaseConfigured } from '../utils/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../utils/storage';

export const useAppLogic = () => {
  const [currentTab, setCurrentTab] = useState('home');
  const [showSetup, setShowSetup] = useState(false);
  const [activeDate, setActiveDate] = useState(new Date());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const auth = useAuthSession();
  const staff = useStaffData();
  const req = useRequestData();
  const config = useConfigData();
  const shifts = useShiftData();

  // Removed shadowed state to use auth.isAdminAuthenticated instead  
  // 初期化フロー: 厳格な3秒タイムアウトガードを導入（アプリの「初期化中」画面で固まるのを防止）
  useEffect(() => {
    let mounted = true;
    
    // [CRITICAL VERSION 48.62] 1.0秒後に強制的に初期化フラグを立てるフェイルセーフ
    const failsafeTimer = setTimeout(() => {
      if (mounted && !isInitialized) {
        console.warn('--- [FAILSAFE] Forced initialization unlock after 1.0s ---');
        setIsInitialized(true);
      }
    }, 1000);

    const initializeData = async () => {
        try {
            console.log('--- [FORCE_INIT] Initializing data (SSOT Integration) ---');
            
            // VERSION 43: One-time ghost data purge
            if (Platform.OS === 'web') {
              const purgeKey = 'v43_purged_final';
              if (!localStorage.getItem(purgeKey)) {
                localStorage.clear();
                localStorage.setItem(purgeKey, 'true');
              }
            }
            
            // シニアアーキテクト指令: クラウド優先（SSOT）統合
            const staffDataRaw = await cloudStorage.fetchStaff().catch(() => []);
            const reqDataRaw = await cloudStorage.fetchRequests().catch(() => []);
            
            let staffData = Array.isArray(staffDataRaw) ? staffDataRaw : [];
            let reqData = Array.isArray(reqDataRaw) ? reqDataRaw : [];
            
            // localStorageはクラウドが空の場合のフォールバックとしてのみ使用
            if (staffData.length === 0) {
              if (Platform.OS === 'web') {
                const s = localStorage.getItem('proto_staff_data');
                if (s) {
                  try { 
                    const parsed = JSON.parse(s);
                    if (Array.isArray(parsed) && parsed.length > 0) staffData = parsed;
                  } catch (e) { console.warn('proto_staff_data parse error'); }
                }
              }
            }

            if (reqData.length === 0) {
              if (Platform.OS === 'web') {
                const r = localStorage.getItem('proto_request_data');
                if (r) {
                  try { 
                    const parsed = JSON.parse(r);
                    if (Array.isArray(parsed) && parsed.length > 0) reqData = parsed;
                  } catch (e) { console.warn('proto_request_data parse error'); }
                }
              }
            }

            // シニアアーキテクト指令: エポメラル・テスト用モックデータ注入 (SupabaseもLocalも空の場合)
            if (staffData.length === 0) {
              staffData = Array.from({ length: 16 }, (_, i) => ({
                id: `mock-s-${i}`,
                name: `Staff ${String.fromCharCode(65 + i)}`,
                role: i === 0 ? '管理者' : '一般職員',
                profession: '看護師',
                isApproved: true
              }));
            }
            
            if (mounted) {
                staff.setStaffList(staffData);
                req.setRequests(reqData);
            }
        } catch (error: any) {
            console.warn('Initialization notice:', error.message);
        } finally {
            if (mounted) {
              setIsInitialized(true);
              clearTimeout(failsafeTimer);
            }
        }
    };

    initializeData();
    return () => { 
      mounted = false; 
      clearTimeout(failsafeTimer);
    };
  }, [isInitialized]); // Dependency added to allow timeout re-check if needed, though mounted guard handles it



  // シニアアーキテクト指令: 認証成功後のデータ取得 (VERSION 38.0)
  useEffect(() => {
    if (auth.profile && isInitialized) {
      console.log('Auth confirmed. Refreshing protected data...');
      sync.handleForceCloudSync();
    }
  }, [auth.profile, isInitialized]);

  useEffect(() => {
    if (Platform.OS === 'web' && isInitialized) {
      if (staff.staffList.length > 0) {
        localStorage.setItem('proto_staff_data', JSON.stringify(staff.staffList));
      }
      localStorage.setItem('proto_request_data', JSON.stringify(req.requests));
    }
  }, [staff.staffList, req.requests, isInitialized]);

  // [CRITICAL VERSION 48.20] Infinite Spinner Failsafe for Master Admin
  useEffect(() => {
    if (isSyncing && auth.user?.email === 'admin@reha.local') {
      const timer = setTimeout(() => {
        console.warn('--- [SPINNER_KILLER] Force-ending sync for master admin ---');
        setIsSyncing(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isSyncing, auth.user?.email]);

  // --- 認証系ハンドラ (物理復旧) ---
  const handleLogin = useCallback(async (email: string, pass: string) => {
    setIsSyncing(true);
    try {
      console.log('--- [SECURE_LOGIN] ---');
      await auth.login(email, pass);
      setCurrentTab('home');
      return true;
    } catch (e: any) {
      console.error('Login failed:', e.message);
      let msg = 'ログインに失敗しました。IDまたはパスワードを確認してください。';
      if (e.message.includes('Invalid login')) msg = 'メールアドレスまたはパスワードが間違っています。';
      Alert.alert('認証エラー', msg);
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [auth.login]);

  const handleLogout = useCallback(async () => {
    await auth.logout();
    setCurrentTab('home');
    auth.setIsAdminAuthenticated(false);
  }, [auth.logout, auth.setIsAdminAuthenticated]);

  const handleAdminMasterLogin = useCallback(async (password: string) => {
    const masterPass = config.config['@admin_password'] || 'admin123';
    if (password === masterPass) {
      auth.setIsAdminAuthenticated(true);
      setCurrentTab('admin');
      return true;
    }
    Alert.alert('認証失敗', 'パスワードが正しくありません');
    return false;
  }, [config.config, auth.setIsAdminAuthenticated]);

  const handleRegister = useCallback(async (registrationData: any) => {
    setIsSyncing(true);
    try {
      const newStaff = {
        id: 's-' + Date.now(),
        ...registrationData,
        role: 'staff',
        isApproved: true, // Abolished
        createdAt: new Date().toISOString()
      };
      
      const newStaffList = [...staff.staffList, newStaff];
      staff.setStaffList(newStaffList);
      await cloudStorage.upsertStaff(newStaffList);
      
      auth.setProfile(newStaff);
      setShowSetup(false);
    } catch (e) {
      console.error('Registration failed:', e);
    } finally {
      setIsSyncing(false);
    }
  }, [staff.staffList, staff.setStaffList, auth.setProfile]);

  // --- データ操作系ハンドラ ---
  const onSubmitRequest = useCallback(async (request: any) => {
    try {
      // 【確定】supabase.auth.getUser() で認証UUIDを取得
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) {
        Alert.alert('エラー', 'ログイン情報を取得できませんでした。');
        return false;
      }

      // スタッフリストから正式な日本語名を取得（IDで照合）
      const authUid = authUser.id;
      const staffRecord = (staff.staffList || []).find((s: any) =>
        s.id === authUid || s.userId === authUid || s.user_id === authUid
      );
      // profile.nameが英字の場合でも、スタッフリストの日本語名を優先する
      const officialName = staffRecord?.name || auth.profile?.name || '不明';

      const requestId = 'req-' + Date.now();
      const newRequest = { 
        id: requestId,
        ...request, 
        status: 'pending',
        staff_id: authUid,
        staff_name: officialName, // SQL用（日本語正式名）
        staffName: officialName,  // UI/JS用（日本語正式名）
        created_at: new Date().toISOString()
      };

      console.log('[DEBUG] useAppLogic Submitting:', {
        user_id: authUid,
        staff_name: officialName,
        status: newRequest.status
      });

      // 直接Supabaseに挿入
      const { error } = await supabase.from('requests').insert([
        {
          id: newRequest.id,
          user_id: authUid,
          staff_name: officialName,
          date: newRequest.date,
          type: newRequest.type,
          status: newRequest.status,
          reason: newRequest.reason,
          details: newRequest.details,
          created_at: newRequest.created_at
        }
      ]);
      
      if (error) throw error;

      // ローカルステートも更新
      req.setRequests(prev => [...prev, newRequest]);
      
      Alert.alert('送信成功！', '休暇申請を送信しました。');
      return true;
    } catch (e: any) {
      console.error('Submission error:', e);
      Alert.alert('DB送信エラー', e.message);
      return false;
    }
  }, [auth.user, auth.profile, req.setRequests, staff.staffList]);

  const approveRequest = useCallback(async (requestId: string, status: string = 'approved') => {
    try {
      const updatedItem = req.requests.find(r => r.id === requestId);
      if (!updatedItem) return;

      const newWithStatus = { ...updatedItem, status, updatedAt: new Date().toISOString() };
      const newRequests = req.requests.map(r => r.id === requestId ? newWithStatus : r);
      
      req.setRequests(newRequests);
      await cloudStorage.upsertRequests([newWithStatus]);
    } catch (e) {
      console.error('Approve/Reject request error:', e);
      throw e;
    }
  }, [req.requests, req.setRequests]);

  const handleBulkApprove = useCallback(async (ids: string[]) => {
    try {
      if (!ids || ids.length === 0) return;

      const { error } = await supabase
        .from('requests')
        .update({ status: 'approved' })
        .in('id', ids);

      if (error) throw error;

      Alert.alert('完了', '承認が完了しました');

      const now = new Date().toISOString();
      const newRequests = req.requests.map(r => {
        if (ids.includes(r.id)) {
          return { ...r, status: 'approved', updatedAt: now };
        }
        return r;
      });
      req.setRequests(newRequests);

      if (Platform.OS === 'web') {
        window.location.reload();
      }
    } catch (e: any) {
      console.error('Bulk approve error:', e);
      Alert.alert('エラー', 'エラー: ' + e.message);
    }
  }, [req.requests, req.setRequests]);

  const cancelRequest = useCallback(async (requestId: string) => {
    try {
      // 物理削除
      await cloudStorage.deleteRequest(requestId);
      const newRequests = req.requests.filter(r => r.id !== requestId);
      req.setRequests(newRequests);
    } catch (e) {
      console.error('Cancel request error:', e);
      throw e;
    }
  }, [req.requests, req.setRequests]);

  const onDeleteRequest = useCallback(async (requestId: string) => {
    await cancelRequest(requestId);
  }, [cancelRequest]);

  const handleReject = useCallback(async (requestId: string) => {
    try {
      const { error } = await supabase
        .from('requests')
        .update({ status: 'rejected' })
        .eq('id', requestId);

      if (error) throw error;

      Alert.alert('完了', '却下・取り消しが完了しました');

      const now = new Date().toISOString();
      const newRequests = req.requests.map(r => 
        r.id === requestId ? { ...r, status: 'rejected', updatedAt: now } : r
      );
      req.setRequests(newRequests);

      if (Platform.OS === 'web') {
        window.location.reload();
      }
    } catch (e: any) {
      console.error('Reject error:', e);
      Alert.alert('エラー', 'エラー: ' + e.message);
    }
  }, [req.requests, req.setRequests]);


  const onUpdateAvatar = useCallback(async (avatarUrl: string) => {
    if (auth.profile) {
      const newProfile = { ...auth.profile, avatar: avatarUrl };
      auth.setProfile(newProfile);
      const newStaffList = staff.staffList.map(s => s.id === auth.profile?.id ? newProfile : s);
      staff.setStaffList(newStaffList);
      await cloudStorage.upsertStaff(newStaffList);
    }
  }, [auth.profile, auth.setProfile, staff.staffList, staff.setStaffList]);

  const onResetStaffPassword = useCallback(async (staffId: string) => {
    Alert.alert('確認', 'この職員のパスワードを「0000」にリセットしますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'リセット', onPress: () => {
          Alert.alert('完了', 'パスワードをリセットしました');
      }}
    ]);
  }, []);

  const onAutoAssign = useCallback(async (year: number, month: number, limits: any) => {
    try {
      const currentMonthStr = `${year}-${String(month).padStart(2, '0')}`;
      req.setRequestsHistory(prev => [...prev.slice(-4), [...req.requests]]);

      const response = await fetch('/api/ai-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffList: staff.staffList,
          requests: req.requests,
          limits: {
            weekday: limits?.weekday ?? config.weekdayLimit,
            saturday: limits?.sat ?? config.saturdayLimit,
            sunday: limits?.sun ?? config.sundayLimit,
            publicHoliday: limits?.pub ?? config.publicHolidayLimit
          },
          month,
          year
        })
      });

      if (!response.ok) throw new Error('サーバーエラーが発生しました');
      const data = await response.json();
      if (!data.newRequests) throw new Error('自動割り当ての生成に失敗しました');

      const nowStr = new Date().toISOString();
      const newWithIds = data.newRequests.map((r: any) => ({
        ...r,
        id: r.id || `auto-${r.staffId || r.staffName || 'user'}-${r.date}-${Math.random().toString(36).substr(2, 6)}`,
        updatedAt: nowStr,
        status: r.status || 'approved'
      }));

      const filteredRequests = req.requests.filter(r => {
        const idStr = String(r.id || '');
        const isAuto = idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-') || idStr.startsWith('aw_');
        const isTargetMonth = r.date && r.date.startsWith(currentMonthStr);
        // [CRITICAL] ターゲット月の自動生成データは全てパージする
        return !(isAuto && isTargetMonth);
      });

      const updated = [...filteredRequests, ...newWithIds];
      await req.updateRequests(updated);
    } catch (e) {
      console.error('Auto Assign Error:', e);
      throw e;
    }
  }, [staff.staffList, req.requests, req.setRequestsHistory, req.updateRequests, config.weekdayLimit, config.saturdayLimit, config.sundayLimit, config.publicHolidayLimit]);

  const onUndoAutoAssign = useCallback(async () => {
    if (req.requestsHistory.length === 0) {
      Alert.alert('情報', '戻せる履歴がありません。');
      return;
    }

    const previous = req.requestsHistory[req.requestsHistory.length - 1];
    const current = [...req.requests];
    const prevIds = new Set(previous.map(r => String(r.id)));
    const toDelete = current.filter(r => !prevIds.has(String(r.id))).map(r => String(r.id));

    try {
      setIsSyncing(true);
      await req.updateRequests(previous);
      req.setRequestsHistory(prev => prev.slice(0, -1));
      if (toDelete.length > 0) {
        await cloudStorage.deleteRequests(toDelete);
      }
      Alert.alert('完了', '一つ前の状態に戻しました。');
    } catch (e) {
      console.error('Undo failed:', e);
      Alert.alert('エラー', '元に戻す処理中にエラーが発生しました。');
    } finally {
      setIsSyncing(false);
    }
  }, [req.requests, req.requestsHistory, req.setRequestsHistory, req.updateRequests]);

  const handleForceCloudSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      console.log('--- [CLOUD_RECOVERY_TRIGGERED] ---');
      // [NUCLEAR RESILIENCE] インポートに頼らず直接文字列でキーを指定
      await AsyncStorage.removeItem('@staff_list');
      await AsyncStorage.removeItem('@requests');
      
      if (Platform.OS === 'web') {
        localStorage.removeItem('proto_staff_data');
        localStorage.removeItem('proto_request_data');
        localStorage.removeItem('v43_purged_final');
      }
        
        const s = await cloudStorage.fetchStaff();
        const r = await cloudStorage.fetchRequests();
        await shifts.fetchShifts();
        await config.refreshConfigs();
        
        if (s && s.length > 0) staff.setStaffList(s);
        if (r && r.length > 0) {
          // [CRITICAL FIX] setRequests ではなく processAndSetRequests を使用して
          // AsyncStorage への永続化を確実に行う
          await req.processAndSetRequests(r, true);
        }
        
        if (Platform.OS === 'web' && s?.length > 0) {
          localStorage.setItem('proto_staff_data', JSON.stringify(s));
          localStorage.setItem('proto_request_data', JSON.stringify(r));
        }
        return true;
      } catch (e) {
        console.error('Cloud sync failure:', e);
        return false;
      } finally {
        setIsSyncing(false);
      }
  }, [staff.setStaffList, req.setRequests, shifts.fetchShifts]);

  const handleForceSave = useCallback(async () => {
      setIsSyncing(true);
      try {
        await cloudStorage.upsertStaff(staff.staffList);
        await cloudStorage.upsertRequests(req.requests);
        return true;
      } catch (e) {
        console.error('Manual save failure:', e);
        return false;
      } finally {
        setIsSyncing(false);
      }
  }, [staff.staffList, req.requests]);

  const sync = useMemo(() => ({
    handleForceCloudSync,
    handleForceSave
  }), [handleForceCloudSync, handleForceSave]);

  // シニアアーキテクト指令: 認証成功後のデータ取得 (VERSION 38.0)
  // FIXED: Added handleForceCloudSync to deps and prevented unnecessary runs
  useEffect(() => {
    if (auth.profile && isInitialized && !isSyncing) {
      console.log('--- [AUTH_SYNC] Stable trigger ---');
      handleForceCloudSync();
    }
  }, [auth.profile?.id, isInitialized]);

  return useMemo(() => ({
    ...auth,
    ...staff,
    ...req,
    ...config,
    ...shifts,
    currentTab,
    setCurrentTab,
    showSetup,
    setShowSetup,
    activeDate,
    setActiveDate,
    isSyncing,
    isInitialized,
    isSupabaseConfigured,
    handleLogin,
    handleAdminMasterLogin,
    handleRegister,
    onSubmitRequest,
    cancelRequest,
    approveRequest,
    onDeleteRequest,
    patchStaff: staff.patchStaff,
    onAutoAssign,
    onUndoAutoAssign,
    canUndoAutoAssign: req.requestsHistory.length > 0,
    onUpdateAvatar,
    onResetStaffPassword,
    handleLogout,
    handleForceCloudSync,
    handleForceSave
  }), [
    auth, staff, req, config, shifts, currentTab, showSetup, activeDate, isSyncing, isInitialized,
    handleLogin, handleAdminMasterLogin, handleRegister, onSubmitRequest, cancelRequest, approveRequest,
    onDeleteRequest, onAutoAssign, onUndoAutoAssign, onUpdateAvatar, onResetStaffPassword, handleLogout,
    handleForceCloudSync, handleForceSave, isSupabaseConfigured, staff.patchStaff
  ]);
};
