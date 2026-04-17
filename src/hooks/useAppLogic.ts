// @ts-nocheck
import { useState, useCallback, useEffect, useRef } from 'react';
import { Platform, Alert, AppState } from 'react-native';
import { useAuthSession } from './useAuthSession';
import { useStaffData } from './useStaffData';
import { useRequestData } from './useRequestData';
import { useConfigData } from './useConfigData';
import { cloudStorage } from '../utils/cloudStorage';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { normalizeName } from '../utils/staffUtils';
import { deduplicateRequests } from '../utils/requestUtils';
import { getDateStr } from '../utils/dateUtils';
import { APP_CONFIG } from '../constants/Config';
import { supabase } from '../utils/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const useAppLogic = () => {
  const [currentTab, setCurrentTab] = useState('home');
  const [showSetup, setShowSetup] = useState(false);
  const [activeDate, setActiveDate] = useState(new Date());
  const [isSyncing, setIsSyncing] = useState(false);

  const auth = useAuthSession();
  const staff = useStaffData();
  const req = useRequestData();
  const config = useConfigData();

  // --- DATA RESET LOGIC (Run Once) ---
  const performGlobalReset = useCallback(async () => {
    try {
      const isResetRaw = await AsyncStorage.getItem('is_global_reset_done_v4');
      const isReset = isResetRaw != null ? JSON.parse(isResetRaw) : null;
      if (isReset) return;

      console.log('RESET: Performing mandatory data reset v4...');
      await AsyncStorage.clear(); // キャッシュを全消去
      // 1. Clear Supabase tables (Best effort from client side)
      try {
        await supabase.from('requests').delete().not('id', 'is', null);
        await supabase.from('messages').delete().not('id', 'is', null);
        await supabase.from('staff').delete().not('id', 'is', null);
        console.log('RESET: Cloud cleanup attempted.');
      } catch (e) {
        console.warn('Supabase reset skipped or failed (likely RLS):', e);
      }
      
      // 2. Clear Local Storage
      await AsyncStorage.clear();
      
      // 3. Mark as done
      await saveData('is_global_reset_done_v4', 'true');
      console.log('RESET: Completed.');
      
      // Force reload or logout
      await auth.logout();
    } catch (e) { 
      console.error('Reset internal error:', e); 
    }
  }, [auth]);

  // --- Data Consistency: Self-Healing Logic ---
  const healRequests = useCallback(async (currentStaff: any[], currentReqs: any[]) => {
    if (!currentStaff?.length || !currentReqs?.length) return currentReqs;
    
    // Create mapping of normalizedName -> valid Staff
    const staffMap = new Map();
    currentStaff.forEach(s => {
      if (s?.name) staffMap.set(normalizeName(s.name), s);
    });

    let hasChanges = false;
    const healed = (Array.isArray(currentReqs) ? currentReqs : []).map(r => {
      if (!r || !r.staffName) return r;
      
      const normalizedReqName = normalizeName(r.staffName || '');
      const matchedStaff = staffMap.get(normalizedReqName);
      
      if (matchedStaff) {
        // If name matches exactly but ID is missing, or name is slightly different but normalized matches
        const isNameMismatch = r.staffName !== matchedStaff.name;
        const isIdMismatch = String(r.staffId ?? '') !== String(matchedStaff.id ?? '');
        
        if (isNameMismatch || isIdMismatch) {
          hasChanges = true;
          return {
            ...r,
            staffName: matchedStaff.name,
            staffId: matchedStaff.id,
            updatedAt: new Date().toISOString()
          };
        }
      }
      return r;
    });

    if (hasChanges) {
      console.log('Self-healing: Fixed data inconsistencies in requests');
      // Trigger update back to local and cloud
      await req.updateRequests(healed);
    }
    return healed;
  }, [req.updateRequests]);

  const handleForceCloudSync = useCallback(async (isBackground = false) => {
    // バックグラウンド同期（リアルタイムイベント等）の場合はUIのローディング状態（点滅）をスキップ
    if (!isBackground) setIsSyncing(true);
    
    try {
      const cloudReqs = await cloudStorage.fetchRequests();
      const cloudStaff = await staff.syncStaffWithCloud();
      
      if (cloudReqs && cloudStaff) {
        const healed = await healRequests(cloudStaff, cloudReqs);
        await req.mergeCloudRequests(healed);
      } else if (cloudReqs) {
        // Fallback if staff list couldn't be synced but we have requests
        await req.mergeCloudRequests(cloudReqs);
      }
      return true;
    } catch (e) { 
      console.error('Sync error:', e);
      return false; 
    } finally { 
      if (!isBackground) setIsSyncing(false); 
    }
  }, [req, staff]); // Removed isSyncing from dependencies to avoid loop

  const handleForceSave = async () => {
    setIsSyncing(true);
    try {
      await cloudStorage.forceStoreRequests(Array.isArray(req?.requests) ? req.requests : []);
      if (Platform.OS === 'web') window.alert('✅ 保存完了');
      else Alert.alert('✅ 完了', '保存しました');
    } catch (e: any) { 
      console.error('Force save error:', e);
      Alert.alert('エラー', '保存に失敗しました: ' + (e.message || ''));
    } finally { setIsSyncing(false); }
  };

  const handleForceFetch = async () => {
    setIsSyncing(true);
    try {
      const cr = await cloudStorage.fetchRequests();
      const cs = await staff.syncStaffWithCloud();
      if (cr && cs) {
        const healed = await healRequests(cs, cr);
        await req.mergeCloudRequests(healed);
      } else if (cr) {
        await req.mergeCloudRequests(cr);
      }
      if (Platform.OS === 'web') window.alert('✅ 更新完了');
      else Alert.alert('✅ 完了', '更新しました');
    } catch (e: any) { 
      console.error('Force fetch error:', e);
      Alert.alert('エラー', '更新に失敗しました: ' + (e.message || ''));
    } finally { setIsSyncing(false); }
  };

  const onAutoAssign = useCallback(async (year: number, month: number, limits: any) => {
    setIsSyncing(true);
    try {
      const response = await fetch(`${APP_CONFIG.WEB_URL}/api/ai-shift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffList: staff.staffList,
          requests: req.requests,
          limits: limits,
          month: month,
          year: year
        })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      
      if (data.newRequests && Array.isArray(data.newRequests)) {
        req.setRequestsHistory(prev => [req.requests, ...prev].slice(0, 10));
        await req.updateRequests(prev => [...prev, ...data.newRequests]);
      }
    } catch (e) {
      console.error('Auto Assign Error:', e);
      throw e;
    } finally {
      setIsSyncing(false);
    }
  }, [staff.staffList, req.requests, req.setRequestsHistory, req.updateRequests]);

  const onUndoAutoAssign = useCallback(async () => {
    if (req.requestsHistory.length === 0) return;
    const previous = req.requestsHistory[0];
    await req.updateRequests(previous);
    req.setRequestsHistory(prev => prev.slice(1));
    if (Platform.OS === 'web') window.alert('✅ 1つ前の状態に戻しました');
    else Alert.alert('完了', '1つ前の状態に戻しました');
  }, [req.requestsHistory, req.updateRequests, req.setRequestsHistory]);

  const onDeleteRequests = useCallback(async (ids: string[]) => {
    await req.updateRequests(prev => prev.filter(r => !ids.includes(r.id)));
    await cloudStorage.deleteRequests(ids);
  }, [req.updateRequests]);

  const syncRef = useRef(handleForceCloudSync);
  useEffect(() => {
    syncRef.current = handleForceCloudSync;
  }, [handleForceCloudSync]);

  useEffect(() => {
    let isMounted = true;

    const initializeData = async () => {
      try {
        // 0. 強制リセット（一度だけ実行、失敗しても先に進む）
        await performGlobalReset();

        // 1. 起動時の初期同期（クラウド最優先）
        // タイムアウトやネットワークエラーでも後続のサブスクリプション等を阻害しない
        await handleForceCloudSync(true).catch(e => console.error('Init sync failed:', e));
      } catch (e) {
        console.error('initializeData fatal error:', e);
      }
    };

    initializeData();

    // 2. リアルタイム同期のサブスクリプション
    const channel = cloudStorage.subscribeToChanges(() => {
      if (isMounted) {
        syncRef.current(true);
      }
    });

    return () => {
      isMounted = false;
      cloudStorage.unsubscribe(channel);
    };
  }, []);

  const handleLogin = useCallback(async (loginDataInput: any, password?: string) => {
    setIsSyncing(true);
    try {
      // Normalization: Ensure case-insensitivity with absolute null safety
      if (!loginDataInput) {
        throw new Error('ログインデータが不足しています');
      }

      let loginData = loginDataInput;
      if (typeof loginDataInput === 'string') {
        loginData = loginDataInput.toLowerCase().trim();
      } else if (loginDataInput?.name) {
        loginData = { ...loginDataInput, name: String(loginDataInput.name).toLowerCase().trim() };
      } else if (loginDataInput?.email) {
        loginData = { ...loginDataInput, email: String(loginDataInput.email).toLowerCase().trim() };
      }

      // --- EMERGENCY BYPASS (Hardcoded) ---
      const isEmergencyAdmin = (
        loginData === 'admin' || 
        loginData?.id === 'admin' || 
        loginData?.email === 'admin' || 
        loginData?.name === 'admin'
      ) && (password === 'admin123' || password === '0000');

      if (isEmergencyAdmin) {
        const adminProfile = {
          id: 'admin',
          name: '管理者 (Emergency)',
          role: '開発者',
          profession: '管理者',
          placement: '本部'
        };
        await auth.setProfile(adminProfile);
        await auth.setIsAdminAuthenticated(true);
        // 同期はバックグラウンドで
        handleForceCloudSync(true).catch(e => console.error('Emergency sync failed:', e));
        return true;
      }

      // --- REAL SUPABASE AUTH ---
      let targetEmail = loginData?.email;
      const targetName = loginData?.name;

      // 名前入力の場合、ダミーメール形式に変換
      if (!targetEmail && targetName) {
        targetEmail = targetName.includes('@') ? targetName : `${targetName}@app.local`;
      }

      console.log('Attempting login for:', targetName || loginDataInput);

      if (password) {
        // --- 自己修復機能付きログイン呼び出し ---
        // auth.login 内で自動的に loadProfile(session, name) が実行され、
        // 名前一致による user_id の自動紐付け（自己修復）が行われます。
        await auth.login(targetName || String(loginDataInput), password);
        
        // 成功後のバックグラウンド同期
        handleForceCloudSync(true).catch(e => console.error('Background sync after login failed:', e));
        
        return true;
      }

      throw new Error('氏名とパスワードを正しく入力してください');
    } catch (e: any) {
      console.error('Login error detailed:', e);
      const errorMsg = e.message || '不明なエラーが発生しました';
      
      // UIにバックエンドの生のエラーを表示（ユーザーの要求）
      const displayMsg = `❌ ログイン失敗: ${errorMsg}`;
      if (Platform.OS === 'web') window.alert(displayMsg);
      else Alert.alert('ログイン失敗', errorMsg);
      
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [auth, handleForceCloudSync]);

  const handleRegister = useCallback(async (staffInfoInput: any, emailInput?: string, password?: string) => {
    setIsSyncing(true);
    try {
      // Normalization: Ensure case-insensitivity
      const staffInfo = {
        ...staffInfoInput,
        name: staffInfoInput?.name ? String(staffInfoInput.name).toLowerCase().trim() : ''
      };
      const email = emailInput ? String(emailInput).toLowerCase().trim() : '';

      // 0. 初回ユーザーかどうかのチェック
      const { count, error: countError } = await supabase
        .from('staff')
        .select('*', { count: 'exact', head: true });
      
      const isFirstUser = !countError && count === 0;
      console.log('Registration pre-check: count =', count, 'isFirstUser =', isFirstUser);

      let userId = null;
      
      // 1. Supabase Auth ユーザーの作成
      if (email && password) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        userId = data.user?.id;
      }

      // 2. staff テーブルにプロファイルを作成
      // 初回ユーザーの場合は自動的に「管理者・開発者」権限を付与し、承認済みにする
      const newProfile = {
        ...staffInfo,
        id: staffInfo.id || 'staff_' + Date.now(),
        pin: staffInfo.pin?.trim() || '0000',
        user_id: userId,
        role: isFirstUser ? ['管理者', '開発者'] : (staffInfo.role || '一般職員'),
        isApproved: isFirstUser ? true : (staffInfo.isApproved || false),
        placement: isFirstUser ? '本部' : (staffInfo.placement || '未設定'),
        created_at: new Date().toISOString()
      };

      await cloudStorage.upsertSingleStaff(newProfile);

      // 3. 状態の更新
      await staff.updateStaffList(prev => [...prev, newProfile]);
      
      // 初回管理者の場合、即座に管理者として認証を通す
      if (isFirstUser) {
        await auth.setProfile(newProfile);
        await auth.setIsAdminAuthenticated(true);
        setCurrentTab('admin');
      } else if (!userId) {
        await auth.setProfile(newProfile);
      }
      
      setShowSetup(false);
      const msg = isFirstUser ? '✅ 初回管理者として登録・認証されました' : '✅ 登録完了（管理者の承認をお待ちください）';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('完了', msg);
      
      return true;
    } catch (e: any) {
      console.error('Registration error:', e);
      let errorMsg = e.message || '不明なエラーが発生しました';
      
      // 重複エラー（以前登録したことがある名前など）への特別対応
      if (errorMsg.includes('User already registered')) {
        errorMsg = 'この名前は既に使用されています。以前登録されたか、同姓同名の方がいます。名前の末尾に数字（例：田中2）を付けるか、別の名前を試してください。';
      } else if (errorMsg.includes('invalid format')) {
        errorMsg = '入力された名前に使用できない文字が含まれているか、形式が正しくありません。';
      }
      
      if (Platform.OS === 'web') window.alert('❌ 登録失敗: ' + errorMsg);
      else Alert.alert('登録失敗', errorMsg);
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [auth, staff.updateStaffList, setShowSetup, auth.setProfile, auth.setIsAdminAuthenticated, setCurrentTab]);

  const handleAdminMasterLogin = useCallback(async (inputPass: string) => {
    if (!inputPass) return false;
    setIsSyncing(true);
    try {
      // 1. マスターパスワードの取得と検証
      // DBが空の場合でもフォールバックとして '0000' を受け入れる
      let masterPass = null;
      try {
        masterPass = await cloudStorage.fetchConfig(STORAGE_KEYS.ADMIN_PASSWORD);
      } catch (e) {
        console.warn('Config fetch failed, using internal fallback');
      }
      
      const DEFAULT_PASS = '0000';
      const isValid = (inputPass === DEFAULT_PASS) || (masterPass && inputPass === masterPass);
      
      if (!isValid) {
        throw new Error('パスワードが違います');
      }

      // 2. 全データの強制同期（復旧）
      const cloudReqs = await cloudStorage.fetchRequests();
      const cloudStaff = await staff.syncStaffWithCloud();
      
      // スタッフデータが存在すればログイン画面に戻すためのヒントを表示
      if (cloudStaff && cloudStaff.length > 0) {
        await healRequests(cloudStaff, cloudReqs || []);
        if (Platform.OS === 'web') window.alert('✅ データを復旧しました\n登録済みのメールアドレスでログインしてください。');
        else Alert.alert('成功', 'データを復旧しました。登録済みのメールアドレスとパスワードでログインしてください。');
        return true;
      } else {
        // データが何もない場合は、管理画面に強制入館させる
        // 臨時プロフィールの割り当て（App.tsx のログインガードをバイパスするため）
        setProfile({ 
          id: 'admin_temp', 
          name: '臨時管理者', 
          role: '開発者', 
          profession: '管理者', 
          placement: '本部',
          isApproved: true 
        });
        
        await auth.setIsAdminAuthenticated(true);
        setCurrentTab('admin');
        
        if (Platform.OS === 'web') window.alert('🔓 緊急アクセス: 管理者権限でログインしました。データベースが初期化されているため、このまま設定を行ってください。');
        else Alert.alert('通知', 'クラウドにデータがありません。管理者権限で一時的にログインしました。');
        return true;
      }
    } catch (e: any) {
      console.error('Master restore error:', e);
      const msg = (e.message && e.message.includes('パスワード')) ? 'パスワードが違います' : (e.message || '接続エラーが発生しました');
      if (Platform.OS === 'web') window.alert('❌ エラー: ' + msg);
      else Alert.alert('認証失敗', msg);
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [staff, healRequests, auth]);

  const approveRequest = useCallback(async (id: string, status: string) => {
    try {
      const requestList = Array.isArray(req?.requests) ? req.requests : [];
      const r = requestList.find(o => o && o.id === id);
      if (!r) return;
      const updated = { ...r, status, updatedAt: new Date().toISOString() };
      
      // Update local and cloud
      await req.updateRequests(prev => Array.isArray(prev) ? prev.map(o => o && o.id === id ? updated : o) : []);
      
      console.log(`Request ${id} status updated to ${status}`);
    } catch (e: any) {
      console.error('approveRequest failed:', e);
      Alert.alert('エラー', '承認ステータスの更新に失敗しました: ' + (e.message || ''));
    }
  }, [req.requests, req.updateRequests]);

  const handleUpdateAuthPassword = async (newPass: string) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) throw error;
      return { success: true };
    } catch (e: any) {
      console.error('Password update error:', e);
      throw e;
    }
  };

  const handleResetStaffPassword = async (staffUserId: string, newPass: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('認証セッションが見つかりません。');

      const response = await fetch('/api/admin-reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          targetUserId: staffUserId,
          newPassword: newPass
        })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'リセットに失敗しました。');
      
      return { success: true };
    } catch (e: any) {
      console.error('Staff password reset error:', e);
      throw e;
    }
  };

  return {
    ...auth, ...staff, ...req, ...config,
    currentTab, setCurrentTab, showSetup, setShowSetup, activeDate, setActiveDate, isSyncing,
    handleForceCloudSync, handleForceSave, handleForceFetch,
    handleLogout: auth.logout,
    handleLogin,
    handleRegister,
    handleAdminMasterLogin,
    onUpdatePassword: handleUpdateAuthPassword,
    onResetStaffPassword: handleResetStaffPassword,
    onAutoAssign, onUndoAutoAssign, onDeleteRequests,
    approveRequest,
    onDeleteRequest: (id: string) => onDeleteRequests([id]),
    onShareApp: () => setCurrentTab('qrShare'),
    canUndoAutoAssign: req.requestsHistory.length > 0
  };
};
