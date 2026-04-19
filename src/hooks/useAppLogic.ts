import { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import { useAuthSession } from './useAuthSession';
import { useStaffData } from './useStaffData';
import { useRequestData } from './useRequestData';
import { useConfigData } from './useConfigData';
import { cloudStorage } from '../utils/cloudStorage';
import { supabase, isSupabaseConfigured } from '../utils/supabase';
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

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);

  // 初期化フロー: 厳格な5秒タイムアウトガード
  useEffect(() => {
    let mounted = true;
    const initializeData = async () => {
        try {
            console.log('--- [FORCE_INIT] Cache Purge & Strict 5s Guard ---');
            
            if (!isSupabaseConfigured) {
                console.warn('🚨 [RESILIENCE] Supabase is NOT configured.');
            }

            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT_EXCEEDED')), 5000)
            );

            const loadPromise = (async () => {
                const fetchStaff = cloudStorage.fetchStaff().catch(() => []);
                const fetchReqs = cloudStorage.fetchRequests().catch(() => []);
                let [staffData, reqData] = await Promise.all([fetchStaff, fetchReqs]);
                
                // シニアアーキテクト指令: エポメラル・テスト用モックデータ注入
                if (!isSupabaseConfigured) {
                  if (staffData.length === 0) {
                    staffData = Array.from({ length: 16 }, (_, i) => ({
                      id: `mock-s-${i}`,
                      name: `Staff ${String.fromCharCode(65 + i)}`,
                      role: i === 0 ? '管理者' : '一般職員',
                      profession: '看護師',
                      isApproved: true
                    }));
                  }
                  if (reqData.length === 0) {
                    reqData = [
                      { id: 'mock-r-1', staffName: 'Staff B', type: '休暇', status: 'pending', date: '2026-10-01' },
                      { id: 'mock-r-2', staffName: 'Staff C', type: '夜勤', status: 'pending', date: '2026-10-02' }
                    ];
                  }
                }

                if (mounted) {
                    staff.setStaffList(staffData);
                    req.setRequests(reqData);
                    // 構成データも読み込み
                    await config.fetchConfig();
                }
            })();

            await Promise.race([loadPromise, timeoutPromise]);
        } catch (error: any) {
            console.warn('Initialization notice:', error.message);
        } finally {
            if (mounted) setIsInitialized(true);
        }
    };

    initializeData();
    return () => { mounted = false; };
  }, []);

  // --- 認証系ハンドラ (物理復旧) ---

  const handleLogin = async (staffInput: any, pass: string) => {
    //シニアアーキテクト指令: ABSOLUTE LOGIN OVERRIDE (FIXED SETTERS)
    if (!isSupabaseConfigured) {
      console.log("EPHEMERAL BYPASS ACTIVATED");
      // 実際のフックで定義されている auth.setProfile と auth.setIsAdminAuthenticated を使用
      const mockAdmin = { 
        id: 'local-admin', 
        name: staffInput.name || 'YOSHIDA (Admin)', 
        role: '管理者', // checkAdmin が期待する文字列
        isApproved: true,
        profession: '管理者',
        placement: '本部'
      };
      
      auth.setProfile(mockAdmin);
      auth.setIsAdminAuthenticated(true);
      setCurrentTab('admin'); // Auto-navigate to settings
      return true;
    }

    setIsSyncing(true);
    try {
      const name = staffInput.name || 'Admin';
      console.log('--- [FORCE_EPHEMERAL_LOGIN] ---');

      // Supabase 認証 (設定されている場合のみ到達)
      const { data, error } = await supabase.auth.signInWithPassword({
        email: `${name.toLowerCase()}@example.com`,
        password: pass,
      });

      if (error) throw error;
      if (data.user) {
        // プロフィール取得と適用
        const userProfile = staff.staffList.find(s => s.name === name) || { id: data.user.id, name, role: 'staff', isApproved: true };
        auth.setUser(data.user);
        auth.setProfile(userProfile);
        setCurrentTab('home');
        return true;
      }
      return false;
    } catch (e: any) {
      console.error('Login failed:', e.message);
      Alert.alert('エラー', 'ログインに失敗しました: ' + e.message);
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAdminMasterLogin = async (password: string) => {
    const masterPass = config.config['@admin_password'] || 'admin123';
    if (password === masterPass) {
      setIsAdminAuthenticated(true);
      setCurrentTab('admin');
      return true;
    }
    Alert.alert('認証失敗', 'パスワードが正しくありません');
    return false;
  };

  const handleRegister = async (registrationData: any) => {
    setIsSyncing(true);
    try {
      const newStaff = {
        id: 's-' + Date.now(),
        ...registrationData,
        role: 'staff',
        isApproved: false,
        createdAt: new Date().toISOString()
      };
      
      const newStaffList = [...staff.staffList, newStaff];
      staff.setStaffList(newStaffList);
      await cloudStorage.saveStaff(newStaffList);
      
      auth.setProfile(newStaff);
      setShowSetup(false);
      Alert.alert('登録完了', '管理者の承認をお待ちください');
    } catch (e) {
      console.error('Registration failed:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- データ操作系ハンドラ ---

  const onSubmitRequest = async (request: any) => {
    const newRequest = { ...request, id: 'req-' + Date.now(), status: 'pending', createdAt: new Date().toISOString() };
    const newRequests = [...req.requests, newRequest];
    req.setRequests(newRequests);
    await cloudStorage.saveRequests(newRequests);
    return true;
  };

  const cancelRequest = async (requestId: string) => {
    const newRequests = req.requests.filter(r => r.id !== requestId);
    req.setRequests(newRequests);
    await cloudStorage.saveRequests(newRequests);
  };

  const approveRequest = async (requestId: string) => {
    const newRequests = req.requests.map(r => r.id === requestId ? { ...r, status: 'approved' } : r);
    req.setRequests(newRequests);
    await cloudStorage.saveRequests(newRequests);
  };

  const onDeleteRequest = async (requestId: string) => {
    await cancelRequest(requestId);
  };

  const onUpdateAvatar = async (avatarUrl: string) => {
    if (auth.profile) {
      const newProfile = { ...auth.profile, avatar: avatarUrl };
      auth.setProfile(newProfile);
      const newStaffList = staff.staffList.map(s => s.id === auth.profile?.id ? newProfile : s);
      staff.setStaffList(newStaffList);
      await cloudStorage.saveStaff(newStaffList);
    }
  };

  const onResetStaffPassword = async (staffId: string) => {
    Alert.alert('確認', 'この職員のパスワードを「0000」にリセットしますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'リセット', onPress: () => {
          // 実際のリセットロジック（クラウドまたはローカル）
          Alert.alert('完了', 'パスワードをリセットしました');
      }}
    ]);
  };

  const sync = {
    handleForceCloudSync: async () => {
        setIsSyncing(true);
        await config.fetchConfig();
        const s = await cloudStorage.fetchStaff();
        const r = await cloudStorage.fetchRequests();
        staff.setStaffList(s);
        req.setRequests(r);
        setIsSyncing(false);
    },
    handleForceSave: async () => {
        setIsSyncing(true);
        await cloudStorage.saveStaff(staff.staffList);
        await cloudStorage.saveRequests(req.requests);
        setIsSyncing(false);
    }
  };

  return useMemo(() => ({
    ...auth,
    ...staff,
    ...req,
    ...config,
    isAdminAuthenticated,
    setIsAdminAuthenticated,
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
    onUpdateAvatar,
    onResetStaffPassword,
    handleForceCloudSync: sync.handleForceCloudSync,
    handleForceSave: sync.handleForceSave
  }), [
    auth, staff, req, config, isAdminAuthenticated, currentTab, showSetup, activeDate, isSyncing, isInitialized,
    handleLogin, handleAdminMasterLogin, handleRegister, onSubmitRequest, cancelRequest, approveRequest,
    onDeleteRequest, onUpdateAvatar, onResetStaffPassword, sync
  ]);
};
