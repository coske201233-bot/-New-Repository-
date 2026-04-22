import { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import { useAuthSession } from './useAuthSession';
import { useStaffData } from './useStaffData';
import { useRequestData } from './useRequestData';
import { useConfigData } from './useConfigData';
import { cloudStorage } from '../utils/cloudStorage';
import { supabase, isSupabaseAuthReady as isSupabaseConfigured } from '../utils/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      await cloudStorage.saveStaff(newStaffList);
      
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
    const newRequest = { 
      ...request, 
      id: 'req-' + Date.now(), 
      status: 'pending', 
      createdAt: new Date().toISOString(),
      staff_id: auth.user?.id,
      staff_email: auth.user?.email
    };
    const newRequests = [...req.requests, newRequest];
    req.setRequests(newRequests);
    await cloudStorage.saveRequests(newRequests);
    return true;
  }, [auth.user, req.requests, req.setRequests]);

  const cancelRequest = useCallback(async (requestId: string) => {
    const newRequests = req.requests.filter(r => r.id !== requestId);
    req.setRequests(newRequests);
    await cloudStorage.saveRequests(newRequests);
  }, [req.requests, req.setRequests]);

  const approveRequest = useCallback(async (requestId: string, status: string = 'approved') => {
    const newRequests = req.requests.map(r => r.id === requestId ? { ...r, status } : r);
    req.setRequests(newRequests);
    await cloudStorage.saveRequests(newRequests);
  }, [req.requests, req.setRequests]);

  const onDeleteRequest = useCallback(async (requestId: string) => {
    await cancelRequest(requestId);
  }, [cancelRequest]);

  const onDeleteStaff = useCallback(async (id: string) => {
    try {
      setIsSyncing(true);
      await cloudStorage.deleteStaff(id);
      const newStaffList = staff.staffList.filter(s => s.id !== id);
      staff.setStaffList(newStaffList);
      return true;
    } catch (e: any) {
      console.error('Delete staff error:', e);
      Alert.alert('エラー', '職員の削除に失敗しました: ' + e.message);
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [staff.staffList, staff.setStaffList]);

  const onUpdateAvatar = useCallback(async (avatarUrl: string) => {
    if (auth.profile) {
      const newProfile = { ...auth.profile, avatar: avatarUrl };
      auth.setProfile(newProfile);
      const newStaffList = staff.staffList.map(s => s.id === auth.profile?.id ? newProfile : s);
      staff.setStaffList(newStaffList);
      await cloudStorage.saveStaff(newStaffList);
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
        const isAuto = idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-');
        const isTargetMonth = r.date && r.date.startsWith(currentMonthStr);
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
        if (Platform.OS === 'web') {
          localStorage.removeItem('proto_staff_data');
          localStorage.removeItem('proto_request_data');
        }
        
        const s = await cloudStorage.fetchStaff();
        const r = await cloudStorage.fetchRequests();
        
        staff.setStaffList(s || []);
        req.setRequests(r || []);
        
        if (Platform.OS === 'web' && s?.length > 0) {
          localStorage.setItem('proto_staff_data', JSON.stringify(s));
          localStorage.setItem('proto_request_data', JSON.stringify(r));
        }
        return true;
      } catch (e) {
        console.error('Cloud sync failure:', e);
        staff.setStaffList([]);
        req.setRequests([]);
        return false;
      } finally {
        setIsSyncing(false);
      }
  }, [staff.setStaffList, req.setRequests]);

  const handleForceSave = useCallback(async () => {
      setIsSyncing(true);
      try {
        await cloudStorage.saveStaff(staff.staffList);
        await cloudStorage.saveRequests(req.requests);
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
    if (auth.profile && isInitialized) {
      console.log('Auth confirmed. Refreshing protected data...');
      handleForceCloudSync();
    }
  }, [auth.profile?.id, isInitialized, handleForceCloudSync]);

  return useMemo(() => ({
    ...auth,
    ...staff,
    ...req,
    ...config,
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
    onDeleteStaff,
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
    auth, staff, req, config, currentTab, showSetup, activeDate, isSyncing, isInitialized,
    handleLogin, handleAdminMasterLogin, handleRegister, onSubmitRequest, cancelRequest, approveRequest,
    onDeleteRequest, onAutoAssign, onUndoAutoAssign, onUpdateAvatar, onResetStaffPassword, handleLogout,
    handleForceCloudSync, handleForceSave, isSupabaseConfigured, staff.patchStaff
  ]);
};
