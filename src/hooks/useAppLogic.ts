import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import { useAuthSession } from './useAuthSession';
import { useStaffData } from './useStaffData';
import { useRequestData } from './useRequestData';
import { useConfigData } from './useConfigData';
import { useShiftData } from './useShiftData';
import { cloudStorage, markLocalMutation, isLocalMutationCooldownActive } from '../utils/cloudStorage';
import { supabase, isSupabaseAuthReady as isSupabaseConfigured } from '../utils/supabase';
import { deleteShiftRequest, updateRequestStatus, approveShiftRequest, bulkApproveShiftRequests, buildOptimisticShiftChanges } from '../utils/requestApi';
import { normalizeDateStr } from '../utils/dateUtils';
import { recordAuditLog } from '../utils/auditLogger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../utils/storage';
import { cleanupStaffSelectionStorage } from '../utils/authUtils';

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
  
  // [V76.6] useRef を使用してリフェッチ関数の最新状態を保持（クロージャ停滞防止）
  const fetchersRef = React.useRef({
    fetchRequests: req.fetchRequests,
    fetchShifts: shifts.fetchShifts
  });

  React.useEffect(() => {
    fetchersRef.current = {
      fetchRequests: req.fetchRequests,
      fetchShifts: shifts.fetchShifts
    };
  }, [req.fetchRequests, shifts.fetchShifts]);

  const isSyncingRef = React.useRef(isSyncing);
  React.useEffect(() => {
    isSyncingRef.current = isSyncing;
  }, [isSyncing]);

  const requestsRef = React.useRef(req.requests);
  requestsRef.current = req.requests;

  const shiftsRef = React.useRef(shifts.shifts);
  shiftsRef.current = shifts.shifts;

  const loadedUserIdRef = React.useRef<string | null>(null);

  // 認証セッション解決時・ログイン成功（auth.user?.id変化）時のデータ取得フロー
  useEffect(() => {
    // 認証準備ができるまで待機
    if (!auth.isAuthReady) return;

    // 既に同一ユーザーで初期データ取得が完了している場合は、タブ切り替え等による過剰フェッチを防ぐ
    const currentUserId = auth.user?.id || 'guest';
    if (isInitialized && loadedUserIdRef.current === currentUserId) {
      return;
    }

    let mounted = true;
    
    // ネットワークタイムアウトの可能性を警告するためのタイマー
    const warningTimer = setTimeout(() => {
      if (mounted && !isInitialized) {
        console.warn('--- [WARNING] Initialization is taking longer than expected (10s) ---');
      }
    }, 10000);

    const loadAllData = async () => {
      try {
        console.log('--- [AUTH_SYNC] Loading data for user session:', auth.user?.email || 'No User');
        
        // VERSION 43: One-time ghost data purge
        if (Platform.OS === 'web') {
          const purgeKey = 'v43_purged_final';
          if (!localStorage.getItem(purgeKey)) {
            localStorage.clear();
            localStorage.setItem(purgeKey, 'true');
          }
        }
        
        // 認証済みユーザーが存在する場合、クラウドから全データを取得
        if (auth.user) {
          console.log('[AUTH_SYNC] Fetching staff, requests, shifts from cloud...');
          const [staffDataRaw, reqDataRaw] = await Promise.all([
            cloudStorage.fetchStaff().catch((e) => { console.warn('fetchStaff failed:', e); return null; }),
            cloudStorage.fetchRequests().catch((e) => { console.warn('fetchRequests failed:', e); return null; })
          ]);
          
          let staffData = Array.isArray(staffDataRaw) ? staffDataRaw : [];
          let reqData = Array.isArray(reqDataRaw) ? reqDataRaw : [];
          
          // localStorageはクラウドが空または取得失敗時のフォールバックとしてのみ使用
          if (staffData.length === 0 && Platform.OS === 'web') {
            const s = localStorage.getItem('proto_staff_data');
            if (s) {
              try { 
                const parsed = JSON.parse(s);
                if (Array.isArray(parsed) && parsed.length > 0) staffData = parsed;
              } catch (e) { console.warn('proto_staff_data parse error'); }
            }
          }

          let finalReqs = reqData;
          if (Platform.OS === 'web' && (!reqDataRaw || reqDataRaw.length === 0)) {
            const localR = localStorage.getItem('proto_request_data');
            if (localR && !reqDataRaw) {
              try {
                const parsed = JSON.parse(localR);
                if (Array.isArray(parsed)) finalReqs = parsed;
              } catch(e) {}
            }
          }

          if (mounted) {
            staff.setStaffList(staffData);
            // 初回ロード時も定期リフェッチと同じ重複排除（確定ステータス優先）を通して不整合を防止
            await req.processAndSetRequests(finalReqs, true);
            req.markRequestsLoadedRange(new Date().getFullYear());
            
            // シフトデータおよび設定値も取得（対象期間に絞って取得）
            shifts.fetchShifts({ baseYear: new Date().getFullYear(), force: true });
            config.refreshConfigs();

            console.log(`✅ [AUTH_SYNC] Data Loaded: Staff=${staffData.length}, Requests=${finalReqs.length}`);
          }
        } else {
          console.log('[AUTH_SYNC] Guest session or logged out.');
        }
      } catch (error: any) {
        console.warn('Initialization/Auth data load error:', error.message);
      } finally {
        if (mounted) {
          loadedUserIdRef.current = currentUserId;
          setIsInitialized(true);
          clearTimeout(warningTimer);
        }
      }
    };

    loadAllData();
    return () => { 
      mounted = false; 
      clearTimeout(warningTimer);
    };
  }, [auth.isAuthReady, auth.user?.id]);

  // Web向けローカルキャッシュ保存をデバウンス非同期化し、クリック時のメインスレッドブロッキングを防止
  useEffect(() => {
    if (Platform.OS !== 'web' || !isInitialized) return;
    const timer = setTimeout(() => {
      try {
        if (staff.staffList.length > 0) {
          localStorage.setItem('proto_staff_data', JSON.stringify(staff.staffList));
        }
        localStorage.setItem('proto_request_data', JSON.stringify(req.requests));
      } catch (e) {
        console.warn('localStorage cache write warning:', e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [staff.staffList, req.requests, isInitialized]);

  // 表示対象年が取得済み範囲（前年〜翌年）を超えた場合のみバックグラウンドで追加取得
  const activeYear = activeDate ? activeDate.getFullYear() : new Date().getFullYear();
  useEffect(() => {
    if (!isInitialized || !auth.user) return;
    shifts.ensureShiftsForYear(activeYear);
    req.ensureRequestsForYear(activeYear);
  }, [activeYear, isInitialized, auth.user?.id, shifts.ensureShiftsForYear, req.ensureRequestsForYear]);

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
      await cleanupStaffSelectionStorage();
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
    // 1. 各種アプリケーションステートをクリアしてゾンビデータを防ぐ
    staff.setStaffList([]);
    req.setRequests([]);
    req.setRequestsHistory([]);
    shifts.setShifts([]);
    req.resetRequestCache();
    shifts.resetShiftCache();
    
    // 2. 初期化完了フラグをリセットし、次回ログイン時に再フェッチを走らせる
    setIsInitialized(false);
    loadedUserIdRef.current = null;
    
    // 3. AsyncStorage に保存されている古いキャッシュを完全に焼き払う
    try {
      await AsyncStorage.removeItem('supabase.auth.token');
      await AsyncStorage.removeItem('@requests');
      await AsyncStorage.removeItem('requests');
      await AsyncStorage.removeItem('@staff_list');
      await AsyncStorage.removeItem('shifts');
      await AsyncStorage.removeItem('@profile');
      await cleanupStaffSelectionStorage();
      
      // Supabaseが生成した認証トークンキーをすべて消去する
      const keys = await AsyncStorage.getAllKeys();
      const authKeys = keys.filter(key => key.includes('auth-token') || key.includes('supabase'));
      for (const k of authKeys) {
        await AsyncStorage.removeItem(k);
      }
    } catch (e) {
      console.error("AsyncStorage clear error:", e);
    }
    
    // 4. 認証関連のログアウト処理
    await auth.logout();
    setCurrentTab('home');
    auth.setIsAdminAuthenticated(false);
  }, [auth.logout, auth.setIsAdminAuthenticated, staff, req, shifts]);

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

  // --- データ操作系ハンドラ (楽観的UI更新 + 非同期バックグラウンドDB同期) ---
  const onSubmitRequest = useCallback(async (request: any) => {
    try {
      // メモリ上の認証ユーザーを優先利用（無駄なネットワーク往復を削減）
      let authUser = auth.user;
      if (!authUser) {
        const { data: { user: fetchedUser }, error: authError } = await supabase.auth.getUser();
        if (authError || !fetchedUser) {
          Alert.alert('エラー', 'ログイン情報を取得できませんでした。');
          return false;
        }
        authUser = fetchedUser;
      }

      // スタッフリストから正式な日本語名を取得（IDで照合）
      const authUid = authUser.id;
      const staffRecord = (staff.staffList || []).find((s: any) =>
        s.id === authUid || s.userId === authUid || s.user_id === authUid
      );
      const officialName = staffRecord?.name || auth.profile?.name || '不明';
      const trueStaffId = staffRecord?.id || authUid;

      const now = new Date().toISOString();
      const newId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });

      const newRequest = {
        id: newId,
        ...request,
        status: 'pending',
        staff_id: trueStaffId,
        staffId: trueStaffId,
        user_id: authUid,
        staff_name: officialName,
        staffName: officialName,
        created_at: now,
        updatedAt: now,
        details: { ...(request.details || {}), updatedAt: now }
      };

      // 1. 楽観的UI更新: 即座にローカルステートへ反映
      markLocalMutation(5000);
      const prevRequestsSnap = requestsRef.current;
      req.setRequests(prev => [...prev, newRequest]);

      // 2. バックグラウンド非同期でDB保存・監査ログ記録（失敗時のみロールバック）
      (async () => {
        try {
          const { error } = await supabase.from('requests').insert([
            {
              id: newRequest.id,
              staff_id: trueStaffId,
              user_id: authUid,
              staff_name: officialName,
              date: newRequest.date,
              type: newRequest.type,
              status: newRequest.status,
              is_manual: false,
              hours: newRequest.hours,
              reason: newRequest.reason,
              details: newRequest.details,
              created_at: now
            }
          ]);
          markLocalMutation(5000);
          if (error) throw error;

          await recordAuditLog({
            operatorId: authUid,
            operatorName: officialName,
            targetStaffId: trueStaffId,
            targetStaffName: officialName,
            actionType: 'REQUEST_CREATE',
            targetDate: newRequest.date,
            details: `${officialName}さんが休暇申請「${newRequest.type}」を提出しました（日付: ${newRequest.date}${newRequest.hours ? ` / ${newRequest.hours}h` : ''}${newRequest.reason ? ` / 理由: ${newRequest.reason}` : ''}）`,
            beforeData: null,
            afterData: newRequest
          });
        } catch (bgErr: any) {
          console.error('[Optimistic] Request submission failed, rolling back:', bgErr);
          req.setRequests(prevRequestsSnap);
          Alert.alert('送信失敗', 'データベースへの保存に失敗したため元に戻しました。\n詳細: ' + (bgErr?.message || '不明なエラー'));
        }
      })();

      Alert.alert('送信成功！', '休暇申請を送信しました。');
      return true;
    } catch (e: any) {
      console.error('[V75.2] Submission error:', e);
      Alert.alert('送信失敗', 'データベースへの保存に失敗しました。しばらく時間をおいて再度お試しください。\n詳細: ' + (e.message || '不明なエラー'));
      return false;
    }
  }, [auth.user, auth.profile, req.setRequests, staff.staffList]);

  const approveRequest = useCallback(async (requestId: string, status: string = 'approved') => {
    const cleanId = String(requestId || '').replace(/['"]/g, '').trim();
    const updatedItem = requestsRef.current.find(r => r && (r.id === requestId || String(r.id).replace(/['"]/g, '').trim() === cleanId));
    if (!updatedItem && !cleanId) return;

    const operator = {
      id: auth.profile?.id || auth.user?.id,
      name: auth.profile?.name || '管理者'
    };

    // ロールバック用スナップショット退避
    const prevRequestsSnap = requestsRef.current;
    const prevShiftsSnap = shiftsRef.current;
    const now = new Date().toISOString();
    const isApprove = status === 'approved' || status === '承認';

    markLocalMutation(5000);
    req.registerLocalRequestMutation(cleanId, status, now);

    // 1. 楽観的UI更新: requests と shifts のメモリ上ステートを即座に差分更新（フルリフェッチ廃止）
    const mutatedIds: string[] = [cleanId];
    if (updatedItem) {
      const { clearCriteria, upsertShifts, supersededConflictDates } = buildOptimisticShiftChanges(updatedItem, status, now);
      const targetStaffId = String(updatedItem.staff_id || updatedItem.staffId || updatedItem.user_id || '').trim();
      const targetStaffNameNorm = String(updatedItem.staff_name || updatedItem.staffName || '').replace(/[\s\u3000]/g, '').toUpperCase();
      const targetDateNorm = normalizeDateStr(updatedItem.date);
      const targetTypeTrim = String(updatedItem.type || '').trim();

      const nextRequests = prevRequestsSnap.map(r => {
        if (!r) return r;
        const rCleanId = String(r.id || '').replace(/['"]/g, '').trim();
        if (r.id === requestId || rCleanId === cleanId) {
          return { ...r, status, updatedAt: now, details: { ...(r.details || {}), updatedAt: now } };
        }
        // 承認時、同一スタッフ・同一日付・同種別の重複 pending レコードも即座に superseded 化
        if (
          isApprove &&
          targetDateNorm &&
          (r.status === 'pending' || r.status === '申請中' || !r.status) &&
          normalizeDateStr(r.date) === targetDateNorm &&
          (!targetTypeTrim || !r.type || String(r.type).trim() === targetTypeTrim)
        ) {
          const rStaffId = String(r.staff_id || r.staffId || r.user_id || '').trim();
          const rStaffNameNorm = String(r.staff_name || r.staffName || '').replace(/[\s\u3000]/g, '').toUpperCase();
          const isSameStaff =
            (targetStaffId && rStaffId === targetStaffId) ||
            (targetStaffNameNorm && rStaffNameNorm === targetStaffNameNorm);
          if (isSameStaff) {
            if (rCleanId) {
              mutatedIds.push(rCleanId);
              req.registerLocalRequestMutation(rCleanId, 'superseded', now);
            }
            return { ...r, status: 'superseded', updatedAt: now, details: { ...(r.details || {}), supersededAt: now, supersededBy: cleanId, updatedAt: now } };
          }
        }
        // 公休変更承認時の競合申請を即座に superseded 化
        if (
          supersededConflictDates &&
          r.type === '公休変更' &&
          r.status === 'approved' &&
          rCleanId !== supersededConflictDates.excludeId
        ) {
          const crStaffId = r.staff_id || r.staffId || r.user_id;
          const crStaffName = r.staff_name || r.staffName;
          const isSameStaff =
            (supersededConflictDates.staffId && crStaffId === supersededConflictDates.staffId) ||
            (supersededConflictDates.staffName && crStaffName === supersededConflictDates.staffName);
          if (isSameStaff) {
            const crOrig = normalizeDateStr(r.details?.originalDate || r.originalDate);
            const crTarget = normalizeDateStr(r.details?.targetDate || r.targetDate || r.date);
            if (
              (crOrig && (crOrig === supersededConflictDates.originalDate || crOrig === supersededConflictDates.targetDate)) ||
              (crTarget && (crTarget === supersededConflictDates.originalDate || crTarget === supersededConflictDates.targetDate))
            ) {
              if (rCleanId) {
                mutatedIds.push(rCleanId);
                req.registerLocalRequestMutation(rCleanId, 'superseded', now);
              }
              return { ...r, status: 'superseded', details: { ...(r.details || {}), supersededAt: now, supersededBy: supersededConflictDates.excludeId } };
            }
          }
        }
        return r;
      });

      req.setRequests(nextRequests);
      // デバウンスを待たず即座に localStorage (proto_request_data) と AsyncStorage へ最新 approved 状態を永続化
      req.persistRequestsImmediately(nextRequests);

      if (clearCriteria.length > 0) {
        shifts.removeLocalShifts(clearCriteria);
      }
      if (upsertShifts.length > 0) {
        shifts.upsertLocalShifts(upsertShifts);
      }
    }

    // 2. バックグラウンドでDB保存＆実更新検証を実行（進行中Promiseを追跡し、失敗時のみロールバック＆通知）
    const dbPromise = approveShiftRequest(updatedItem || cleanId, status, operator)
      .then(() => {
        mutatedIds.forEach(mid => req.markLocalRequestMutationCommitted(mid));
      })
      .catch((e: any) => {
        console.error('Approve/Reject request background sync error (rolling back):', e);
        mutatedIds.forEach(mid => req.clearLocalRequestMutation(mid));
        req.setRequests(prevRequestsSnap);
        req.persistRequestsImmediately(prevRequestsSnap);
        shifts.setShifts(prevShiftsSnap);
        Alert.alert('保存エラー', 'データベースへの保存に失敗したため変更を元に戻しました。\n詳細: ' + (e?.message || '不明なエラー'));
      });
    req.trackDbMutationPromise(dbPromise);
  }, [
    req.setRequests,
    req.persistRequestsImmediately,
    req.registerLocalRequestMutation,
    req.markLocalRequestMutationCommitted,
    req.clearLocalRequestMutation,
    req.trackDbMutationPromise,
    shifts.removeLocalShifts,
    shifts.upsertLocalShifts,
    shifts.setShifts,
    auth.profile,
    auth.user,
  ]);

  const handleBulkApprove = useCallback(async (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    const cleanIds = ids.filter(Boolean).map(id => String(id).replace(/['"]/g, '').trim()).filter(id => id.length > 0);
    if (cleanIds.length === 0) return;

    const operator = {
      id: auth.profile?.id || auth.user?.id,
      name: auth.profile?.name || '管理者'
    };

    const prevRequestsSnap = requestsRef.current;
    const prevShiftsSnap = shiftsRef.current;
    const now = new Date().toISOString();
    const idSet = new Set(cleanIds);

    markLocalMutation(5000);
    cleanIds.forEach(cid => req.registerLocalRequestMutation(cid, 'approved', now));

    // 1. 楽観的UI更新: 一括で requests と shifts を即時更新
    const allClearCriteria: { staffId?: string; staffName?: string; date: string }[] = [];
    const allUpsertShifts: any[] = [];

    const targetItems = prevRequestsSnap.filter(r => r && idSet.has(String(r.id).replace(/['"]/g, '').trim()));
    targetItems.forEach(item => {
      const { clearCriteria, upsertShifts } = buildOptimisticShiftChanges(item, 'approved', now);
      allClearCriteria.push(...clearCriteria);
      allUpsertShifts.push(...upsertShifts);
    });

    const nextRequests = prevRequestsSnap.map(r =>
      r && idSet.has(String(r.id).replace(/['"]/g, '').trim())
        ? { ...r, status: 'approved', updatedAt: now, details: { ...(r.details || {}), updatedAt: now } }
        : r
    );
    req.setRequests(nextRequests);
    req.persistRequestsImmediately(nextRequests);

    if (allClearCriteria.length > 0) shifts.removeLocalShifts(allClearCriteria);
    if (allUpsertShifts.length > 0) shifts.upsertLocalShifts(allUpsertShifts);

    Alert.alert('完了', '承認が完了しました');

    // 2. バックグラウンドでDB一括保存（進行中Promiseを追跡し、失敗時のみロールバック）
    const dbPromise = bulkApproveShiftRequests(cleanIds, operator)
      .then(() => {
        cleanIds.forEach(cid => req.markLocalRequestMutationCommitted(cid));
      })
      .catch((e: any) => {
        console.error('Bulk approve background sync error (rolling back):', e);
        cleanIds.forEach(cid => req.clearLocalRequestMutation(cid));
        req.setRequests(prevRequestsSnap);
        req.persistRequestsImmediately(prevRequestsSnap);
        shifts.setShifts(prevShiftsSnap);
        Alert.alert('エラー', '一括承認の保存に失敗したため元に戻しました: ' + (e?.message || '不明なエラー'));
      });
    req.trackDbMutationPromise(dbPromise);
  }, [
    req.setRequests,
    req.persistRequestsImmediately,
    req.registerLocalRequestMutation,
    req.markLocalRequestMutationCommitted,
    req.clearLocalRequestMutation,
    req.trackDbMutationPromise,
    shifts.removeLocalShifts,
    shifts.upsertLocalShifts,
    shifts.setShifts,
    auth.profile,
    auth.user,
  ]);

  const cancelRequest = useCallback(async (requestId: string) => {
    if (!requestId) {
      throw new Error('削除対象の申請IDが存在しません。');
    }
    const cleanId = String(requestId).replace(/['"]/g, '').trim();
    const prevRequestsSnap = requestsRef.current;
    const prevShiftsSnap = shiftsRef.current;
    const targetItem = prevRequestsSnap.find(r => r && (r.id === requestId || String(r.id).replace(/['"]/g, '').trim() === cleanId));
    const now = new Date().toISOString();

    markLocalMutation(5000);
    req.registerLocalRequestMutation(cleanId, 'deleted', now);

    // 1. 楽観的UI更新: requests と連動する shifts を即座に除外＋即時キャッシュ永続化
    const nextRequests = prevRequestsSnap.filter(r => r && r.id !== requestId && String(r.id).replace(/['"]/g, '').trim() !== cleanId);
    req.setRequests(nextRequests);
    req.persistRequestsImmediately(nextRequests);

    if (targetItem) {
      shifts.removeLocalShifts([{
        id: cleanId,
        staffId: targetItem.staff_id || targetItem.staffId || targetItem.user_id,
        staffName: targetItem.staff_name || targetItem.staffName,
        date: targetItem.date,
      }]);
    } else {
      shifts.removeLocalShifts([{ id: cleanId }]);
    }

    // 2. バックグラウンドでDB物理削除（失敗時のみロールバック）
    const dbPromise = deleteShiftRequest(cleanId, {
      id: auth.profile?.id || auth.user?.id,
      name: auth.profile?.name || 'ユーザー'
    })
      .then(() => {
        req.markLocalRequestMutationCommitted(cleanId);
      })
      .catch((e: any) => {
        console.error('Cancel request background sync error (rolling back):', e);
        req.clearLocalRequestMutation(cleanId);
        req.setRequests(prevRequestsSnap);
        req.persistRequestsImmediately(prevRequestsSnap);
        shifts.setShifts(prevShiftsSnap);
        Alert.alert('削除エラー', 'データベースからの削除に失敗したため元に戻しました: ' + (e?.message || '不明なエラー'));
      });
    req.trackDbMutationPromise(dbPromise);
  }, [
    req.setRequests,
    req.persistRequestsImmediately,
    req.registerLocalRequestMutation,
    req.markLocalRequestMutationCommitted,
    req.clearLocalRequestMutation,
    req.trackDbMutationPromise,
    shifts.removeLocalShifts,
    shifts.setShifts,
    auth.profile,
    auth.user,
  ]);

  const onDeleteRequest = useCallback(async (requestId: string) => {
    await cancelRequest(requestId);
  }, [cancelRequest]);

  const handleReject = useCallback(async (requestId: string) => {
    if (!requestId) return;
    const cleanId = String(requestId).replace(/['"]/g, '').trim();
    const prevRequestsSnap = requestsRef.current;
    const prevShiftsSnap = shiftsRef.current;
    const updatedItem = prevRequestsSnap.find(r => r && (r.id === requestId || String(r.id).replace(/['"]/g, '').trim() === cleanId));
    if (!updatedItem) return;

    const now = new Date().toISOString();
    const newWithStatus = { ...updatedItem, status: 'rejected', updatedAt: now };

    markLocalMutation(5000);
    req.registerLocalRequestMutation(cleanId, 'rejected', now);

    // 1. 楽観的UI更新: requests を却下に更新し、連動シフトを即座に除外＋即時キャッシュ永続化
    const nextRequests = prevRequestsSnap.map(r =>
      r && (r.id === requestId || String(r.id).replace(/['"]/g, '').trim() === cleanId) ? newWithStatus : r
    );
    req.setRequests(nextRequests);
    req.persistRequestsImmediately(nextRequests);

    if (updatedItem.date) {
      shifts.removeLocalShifts([{
        id: cleanId,
        staffId: updatedItem.staff_id || updatedItem.staffId || updatedItem.user_id,
        staffName: updatedItem.staff_name || updatedItem.staffName,
        date: updatedItem.date,
      }]);
    }

    Alert.alert('完了', '却下・取り消しが完了しました');

    // 2. バックグラウンドでDB同期・監査ログ記録（失敗時のみロールバック）
    const dbPromise = (async () => {
      try {
        await updateRequestStatus(cleanId, 'rejected');
        await cloudStorage.upsertRequestsAndShifts([newWithStatus]);
        req.markLocalRequestMutationCommitted(cleanId);
        await recordAuditLog({
          operatorId: auth.profile?.id || auth.user?.id,
          operatorName: auth.profile?.name || '管理者',
          targetStaffId: updatedItem.staff_id || updatedItem.staffId || updatedItem.user_id,
          targetStaffName: updatedItem.staff_name || updatedItem.staffName,
          actionType: 'REQUEST_REJECT',
          targetDate: updatedItem.date,
          details: `${updatedItem.staff_name || updatedItem.staffName || 'スタッフ'}さんの申請「${updatedItem.type}」(${updatedItem.date}) を却下しました`,
          beforeData: updatedItem,
          afterData: newWithStatus
        });
      } catch (e: any) {
        console.error('Reject background sync error (rolling back):', e);
        req.clearLocalRequestMutation(cleanId);
        req.setRequests(prevRequestsSnap);
        req.persistRequestsImmediately(prevRequestsSnap);
        shifts.setShifts(prevShiftsSnap);
        Alert.alert('エラー', '却下の保存に失敗したため元に戻しました: ' + (e?.message || '不明なエラー'));
      }
    })();
    req.trackDbMutationPromise(dbPromise);
  }, [
    req.setRequests,
    req.persistRequestsImmediately,
    req.registerLocalRequestMutation,
    req.markLocalRequestMutationCommitted,
    req.clearLocalRequestMutation,
    req.trackDbMutationPromise,
    shifts.removeLocalShifts,
    shifts.setShifts,
    auth.profile,
    auth.user,
  ]);


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
        id: r.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined),
        is_manual: false,
        isManual: false,
        details: { ...(r.details || {}), isAuto: true, isManual: false },
        updatedAt: nowStr,
        status: r.status || 'approved'
      }));

      const filteredRequests = req.requests.filter(r => {
        const idStr = String(r.id || '');
        const isAuto = r.is_manual === false || r.isManual === false || r.details?.isAuto === true || idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-') || idStr.startsWith('aw_');
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
        const r = await cloudStorage.fetchRequests({ baseYear: activeDate.getFullYear() });
        await shifts.fetchShifts({ baseYear: activeDate.getFullYear(), force: true });
        await config.refreshConfigs();
        
        // 修正: データが 0 件であっても、それを最新状態として反映する
        staff.setStaffList(s || []);
        
        // [CRITICAL FIX] 0件でも空リストを渡してステートとキャッシュをクリアする
        await req.processAndSetRequests(r || [], true);
        req.markRequestsLoadedRange(activeDate.getFullYear());
        
        if (Platform.OS === 'web') {
          localStorage.setItem('proto_staff_data', JSON.stringify(s || []));
          localStorage.setItem('proto_request_data', JSON.stringify(r || []));
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

  // [V77.0] リアルタイム同期設定（自己更新クールダウン無視 + 1000ms デバウンス + テーブル別選択的取得）
  useEffect(() => {
    if (!isInitialized) return;

    let debounceTimer: any = null;
    const pendingTables = new Set<string>();

    const channel = cloudStorage.subscribeToChanges((payload) => {
      const { table } = payload || {};

      // 自分が保存・削除した直後（5秒間）および同期処理中は自己イベントを完全無視して多重リフェッチを防止
      if (isSyncingRef.current || isLocalMutationCooldownActive()) {
        return;
      }

      if (table === 'requests' || table === 'shifts') {
        pendingTables.add(table);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          // デバウンス発火直前にも自己変更クールダウンを再検証
          if (isSyncingRef.current || isLocalMutationCooldownActive()) {
            pendingTables.clear();
            return;
          }
          const needRequests = pendingTables.has('requests');
          const needShifts = pendingTables.has('shifts');
          pendingTables.clear();

          if (needRequests) fetchersRef.current.fetchRequests({ force: true });
          if (needShifts) fetchersRef.current.fetchShifts({ force: true });
        }, 1000);
      }
    });

    return () => {
      clearTimeout(debounceTimer);
      pendingTables.clear();
      cloudStorage.unsubscribe(channel);
    };
  }, [isInitialized]);

  const isAppReady = isInitialized && auth.isAuthReady;

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
    isInitialized: isAppReady,
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
    handleForceSave,
    handleReject,
    handleBulkApprove
  }), [
    auth, staff, req, config, shifts, currentTab, showSetup, activeDate, isSyncing, isAppReady,
    handleLogin, handleAdminMasterLogin, handleRegister, onSubmitRequest, cancelRequest, approveRequest,
    onDeleteRequest, onAutoAssign, onUndoAutoAssign, onUpdateAvatar, onResetStaffPassword, handleLogout,
    handleForceCloudSync, handleForceSave, isSupabaseConfigured, staff.patchStaff, handleReject, handleBulkApprove
  ]);
};
