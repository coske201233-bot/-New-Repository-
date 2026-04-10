import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, SafeAreaView, Alert, Platform, AppState, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Home, Calendar, User, ClipboardList, Users, Shield, RefreshCw } from 'lucide-react-native';
import { ThemeCard } from './src/components/ThemeCard';
import { HomeScreen } from './src/screens/HomeScreen';
import { CalendarScreen } from './src/screens/CalendarScreen';
import { RequestScreen } from './src/screens/RequestScreen';
import { StaffScreen } from './src/screens/StaffScreen';
import { AdminScreen } from './src/screens/AdminScreen';
import { AdminRequestScreen } from './src/screens/AdminRequestScreen';
import { QrShareScreen } from './src/screens/QrShareScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ThemeText } from './src/components/ThemeText';
import { COLORS, SPACING } from './src/theme/theme';
import { STORAGE_KEYS, saveData, loadData } from './src/utils/storage';
import { cloudStorage } from './src/utils/cloudStorage';
import { sortStaffByName, normalizeName } from './src/utils/staffUtils';
import { getDateStr } from './src/utils/dateUtils';

// Helper to ensure only one request per person per day, prioritizing manual edits
const deduplicateRequests = (list: any[]) => {
  if (!Array.isArray(list)) return { cleanList: [], discardedIds: [] };
  const map = new Map();
  const discardedIds: string[] = [];
  
  const getTime = (i: any) => {
    // 優先順位: 手動指定の updatedAt > 作成日時 > 0
    const t = i.updatedAt || i.updated_at || i.createdAt || i.created_at || 0;
    return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
  };

  const isManual = (i: any) => {
    if (i.isManual === true) return true;
    const idStr = String(i.id || '');
    if (idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('q-h-') || /^\d+$/.test(idStr)) return true;
    const leaveTypes = ['年休', '有給休暇', '時間休', '振替', '1日振替', '半日振替', '振替＋時間休', '公休', '夏季休暇', '午前休', '午後休', '特休', '休暇', '欠勤', '長期休暇', '全休', '午前振替', '午後振替'];
    if (leaveTypes.includes(i.type)) return true;
    return (i.details?.note && !i.details.note.includes('自動')) || (i.reason && i.reason !== '自動割当') || i.details?.isManual === true;
  };

  list.forEach(item => {
    // staffNameとdateがあれば、idがなくても処理対象にする
    if (!item || !item.staffName || !item.date) return;
    
    // idがない場合は一時的なIDを付与
    if (!item.id) {
      item.id = `temp-${item.staffName}-${item.date}-${Date.now()}`;
    }
    
    const key = `${normalizeName(item.staffName)}-${item.date}`;
    const existing = map.get(key);

    const isManualNew = isManual(item);
    const wasManualOld = existing && isManual(existing);
    
    // 【スマホ優先ロジック】 
    // mobileからの更新(idにm-が含まれる、またはpriorityがmobile)を、
    // 同じ手動決定同士であれば優先的に採用する。
    const isMobileNew = String(item.id).startsWith('m-') || item.priority === 'mobile';
    const wasMobileOld = existing && (String(existing.id).startsWith('m-') || existing.priority === 'mobile');

    let isPriority = false;
    if (!existing) {
      isPriority = true;
    } else if (isManualNew && !wasManualOld) {
      // 新しい方が手動で、古い方が自動なら、無条件で新しい方を採用
      isPriority = true;
    } else if (!isManualNew && wasManualOld) {
      // 新しい方が自動で、古い方が手動なら、古い方を維持
      isPriority = false;
    } else {
      // 両者が同じ種別（両方手動、または両方自動）の場合：
      // 1. スマホからの更新であれば優先
      if (isMobileNew && !wasMobileOld) {
        isPriority = true; 
      } else if (!isMobileNew && wasMobileOld) {
        isPriority = false;
      } else {
        // 2. タイムスタンプが新しい方を優先
        const timeNew = getTime(item);
        const timeOld = getTime(existing);
        if (timeNew > timeOld) {
          isPriority = true;
        } else if (timeNew < timeOld) {
          isPriority = false;
        } else {
          // 3. 全く同じ時間なら、確定済み(approved)を優先
          isPriority = item.status === 'approved' && existing.status !== 'approved';
        }
      }
    }

    if (isPriority) {
      if (existing && existing.id !== item.id) discardedIds.push(existing.id);
      map.set(key, item);
    } else {
      if (item.id !== existing.id) discardedIds.push(item.id);
    }
  });
  return { cleanList: Array.from(map.values()), discardedIds };
};

export default function App() {
  const [currentTab, setCurrentTab] = useState('home');
  const [showSetup, setShowSetup] = useState(false);

  // Lifted States
  const [staffList, setStaffList] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [weekdayLimit, setWeekdayLimit] = useState(12);
  const [holidayLimit, setHolidayLimit] = useState(2); 
  const [saturdayLimit, setSaturdayLimit] = useState(2);
  const [sundayLimit, setSundayLimit] = useState(2);
  const [publicHolidayLimit, setPublicHolidayLimit] = useState(2);
  const [monthlyLimits, setMonthlyLimits] = useState<Record<string, { weekday: number, sat: number, sun: number, pub: number }>>({});
  const [adminPassword, setAdminPassword] = useState('1114');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [staffViewMode, setStaffViewMode] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(24); // Hours
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeDate, setActiveDate] = useState(new Date());
  const [requestsHistory, setRequestsHistory] = useState<any[][]>([]);

  // Initial Load (Cloud Sync Integrated)
  useEffect(() => {
    const init = async () => {
      try {
        const loadSyncConfig = async (key: string, setter: (val: any) => void, defaultValue: any) => {
          let localVal = await loadData(key);
          try {
            const cloudVal = await cloudStorage.fetchConfig(key);
            if (cloudVal !== undefined && cloudVal !== null) {
              setter(cloudVal);
              await saveData(key, cloudVal);
              return cloudVal;
            }
          } catch (e) {
            console.warn('Cloud config fetch failed for:', key);
          }
          const finalVal = localVal !== null ? localVal : defaultValue;
          setter(finalVal);
          return finalVal;
        };

        const currentSessionDur = await loadSyncConfig(STORAGE_KEYS.SESSION_DURATION, setSessionDuration, 24);
        const localStaff = await loadData(STORAGE_KEYS.STAFF_LIST);
        const localRequests = await loadData(STORAGE_KEYS.REQUESTS);
        const savedProfile = await loadData(STORAGE_KEYS.PROFILE);

        if (localStaff) {
          const cleaned = localStaff.map((s: any) => {
            if (s.status === '休暇' || s.status === '全休') s.status = '常勤';
            return s;
          });
          setStaffList(sortStaffByName(cleaned));
        }
        if (savedProfile) {
          const lastLogin = savedProfile.lastLoginTimestamp || 0;
          const now = Date.now();
          const durationMs = (currentSessionDur || 24) * 60 * 60 * 1000;
          
          if (now - lastLogin > durationMs) {
            setProfile(null);
            await AsyncStorage.removeItem(STORAGE_KEYS.PROFILE);
          } else {
            setProfile(savedProfile);
            if (savedProfile.role?.includes('シフト管理者') || savedProfile.role?.includes('開発者')) {
              setIsAdminAuthenticated(true);
            }
          }
        }

        try {
          const cloudStaff = await cloudStorage.fetchStaff();
          if (cloudStaff && cloudStaff.length > 0) {
            const normalized = cloudStaff.map((s: any) => {
              const n = { ...s, name: normalizeName(s.name) };
              if (n.status === '休暇' || n.status === '全休') n.status = '常勤';
              return n;
            });
            setStaffList(sortStaffByName(normalized));
            await saveData(STORAGE_KEYS.STAFF_LIST, normalized);
          }

          const cloudRequests = await cloudStorage.fetchRequests();
          if (cloudRequests && cloudRequests.length > 0) {
            const { cleanList, discardedIds } = deduplicateRequests([...(localRequests || []), ...cloudRequests]);
            setRequests(cleanList);
            await saveData(STORAGE_KEYS.REQUESTS, cleanList);
            if (discardedIds.length > 0) {
              await cloudStorage.deleteRequests(discardedIds).catch(console.error);
            }
          } else if (localRequests && localRequests.length > 0) {
            setRequests(localRequests);
          }
        } catch (cloudErr) {
          console.warn('Cloud fetch failed, using local data:', cloudErr);
        }

        await loadSyncConfig(STORAGE_KEYS.WEEKDAY_LIMIT, setWeekdayLimit, 12);
        await loadSyncConfig(STORAGE_KEYS.SATURDAY_LIMIT, setSaturdayLimit, 2);
        await loadSyncConfig(STORAGE_KEYS.SUNDAY_LIMIT, setSundayLimit, 2);
        await loadSyncConfig(STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT, setPublicHolidayLimit, 2);
        await loadSyncConfig(STORAGE_KEYS.MONTHLY_LIMITS, setMonthlyLimits, {});
        await loadSyncConfig(STORAGE_KEYS.ADMIN_PASSWORD, setAdminPassword, '1114');
        await loadSyncConfig(STORAGE_KEYS.STAFF_VIEW_MODE, setStaffViewMode, false);
        
        setIsInitialized(true);
      } catch (e: any) {
        console.error('Initialization error:', e);
        setIsInitialized(true);
      }
    };
    init();
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!isInitialized) return;
    const channel = cloudStorage.subscribeToChanges(() => {
      handleForceCloudSync(true);
    });
    return () => {
      cloudStorage.unsubscribe(channel);
    };
  }, [isInitialized]);

  // Background Sync loop
  useEffect(() => {
    if (!isInitialized) return;
    const interval = setInterval(async () => {
      if (!isSyncing) {
        await handleForceCloudSync(true);
      }
    }, 20000); // 20s interval for background polling
    return () => clearInterval(interval);
  }, [isInitialized, isSyncing]);

  // Profile Sync logic
  useEffect(() => {
    if (profile && staffList.length > 0) {
      const match = staffList.find(s => normalizeName(s.name) === normalizeName(profile.name));
      if (match) {
        let changed = false;
        const newProfile = { ...profile };
        ['position', 'status', 'placement', 'profession', 'role', 'isApproved', 'password', 'noHoliday'].forEach(key => {
          if (match[key] !== profile[key]) {
            newProfile[key] = match[key];
            changed = true;
          }
        });
        if (changed) {
          setProfile(newProfile);
          saveData(STORAGE_KEYS.PROFILE, newProfile);
        }
      }
    }
  }, [staffList, profile]);

  // Active AppState sync
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && profile && isInitialized) {
        if (!isSyncing) handleForceCloudSync(true);
      }
    });
    return () => subscription.remove();
  }, [profile, isInitialized, isSyncing]);

  const handleUpdateStaffList = async (update: any[] | ((prev: any[]) => any[])) => {
    const next = typeof update === 'function' ? update(staffList) : update;
    // 不正なデータを除去
    const cleaned = (next || []).filter((s: any) => s && s.name);
    const sorted = sortStaffByName(cleaned);
    setStaffList(sorted);
    
    // Side effects outside the state setter
    try {
      await saveData(STORAGE_KEYS.STAFF_LIST, sorted);
      if (sorted.length > 0) {
        await cloudStorage.upsertStaff(sorted);
      }
    } catch (err) {
      console.error('Staff sync error:', err);
    }
  };

  const handleUpdateRequests = async (update: any[] | ((prev: any[]) => any[])) => {
    let finalRequests: any[] = [];
    const now = new Date().toISOString();
    // モバイル環境かどうかを簡易判定（PCブラウザ以外を優先）
    const isMobile = Platform.OS !== 'web' || (typeof window !== 'undefined' && window.innerWidth < 768);
    
    setRequests(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      // 新規追加時はidが未付与の場合があるため、staffNameとdateがあれば有効とみなす
      const validOnly = (next || []).filter((r: any) => r && r.staffName && r.date);
      
      // 新しいデータにタイムスタンプ、優先フラグ、および不足しているIDを付与
      const withTimestamp = validOnly.map(r => {
        // IDがなければここで生成
        const finalId = r.id || `m-${r.staffName}-${r.date}-${Math.random().toString(36).substr(2, 9)}`;
        const isNew = !prev.find(p => p.id === finalId && p.status === r.status && p.type === r.type);
        if (isNew) {
           return { ...r, id: finalId, updatedAt: now, priority: isMobile ? 'mobile' : 'pc' };
        }
        return { ...r, id: finalId };
      });
      const { cleanList } = deduplicateRequests(withTimestamp);
      finalRequests = cleanList;
      return cleanList;
    });
    
    try {
      await saveData(STORAGE_KEYS.REQUESTS, finalRequests);
      if (finalRequests.length > 0) {
        await cloudStorage.upsertRequests(finalRequests);
      }
    } catch (err) {
      console.error('Cloud save failed:', err);
    }
  };

  const handleDeleteRequests = async (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    let remaining: any[] = [];
    setRequests(prev => {
      remaining = prev.filter(r => !ids.includes(r.id));
      return remaining;
    });
    try {
      await saveData(STORAGE_KEYS.REQUESTS, remaining);
      await cloudStorage.deleteRequests(ids);
    } catch (e) {
      console.error('Delete sync failed:', e);
    }
  };

  const handleForceCloudSync = async (isBackground = false) => {
    if (isSyncing) return false;
    setIsSyncing(true);
    try {
      // 1. スタッフ情報の取得とマージ
      const cloudStaff = await cloudStorage.fetchStaff();
      if (cloudStaff && cloudStaff.length > 0) {
        const normalized = cloudStaff.map((s: any) => ({ ...s, name: normalizeName(s.name) }));
        const sorted = sortStaffByName(normalized);
        setStaffList(sorted);
        await saveData(STORAGE_KEYS.STAFF_LIST, sorted);
        
        if (profile) {
          const latest = normalized.find((s: any) => String(s.id) === String(profile.id));
          if (latest) setProfile(latest);
        }
      }

      // 2. リクエスト情報の取得・マージ・双方向同期
      const cloudRequests = await cloudStorage.fetchRequests();
      const localRequests = requests.length > 0 ? requests : (await loadData(STORAGE_KEYS.REQUESTS) || []);
      
      const { cleanList, discardedIds } = deduplicateRequests([...localRequests, ...(cloudRequests || [])]);
      
      // ローカルの状態を更新
      setRequests(cleanList);
      await saveData(STORAGE_KEYS.REQUESTS, cleanList);
      
      // 【完全同期の要】クラウド側が古ければローカルから押し上げる
      const needsPush = cleanList.some(lr => {
        const cr = cloudRequests?.find(c => c.id === lr.id);
        if (!cr) return true; // クラウドにないなら追加
        const lt = lr.updatedAt || lr.updated_at || lr.createdAt || lr.created_at || 0;
        const ct = cr.updatedAt || cr.created_at || 0;
        return new Date(lt).getTime() > new Date(ct).getTime();
      });

      if (needsPush) {
        await cloudStorage.upsertRequests(cleanList).catch(console.error);
      }

      if (discardedIds.length > 0) {
        await cloudStorage.deleteRequests(discardedIds).catch(console.error);
      }
      
      return true;
    } catch (e) {
      if (!isBackground) console.error('Sync failed:', e);
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteRequest = async (id: string) => {
    const updatedAt = new Date().toISOString();
    let updatedList: any[] = [];
    setRequests(prev => {
      updatedList = prev.map(r => r.id === id ? { ...r, status: 'deleted', updatedAt, updated_at: updatedAt } : r);
      return updatedList;
    });
    await saveData(STORAGE_KEYS.REQUESTS, updatedList);
    try {
      const target = requests.find(r => r.id === id);
      if (target) await cloudStorage.upsertRequests([{ ...target, status: 'deleted', updatedAt, updated_at: updatedAt }]);
    } catch (error) {
      console.error('Cloud soft-delete failed:', error);
    }
  };

  const handleApproveRequest = async (id: string, status: string) => {
    const todayStr = getDateStr(new Date());
    const updatedAt = new Date().toISOString();
    let finalRequests: any[] = [];
    
    setRequests(prev => {
      finalRequests = prev.map(r => r.id === id ? { ...r, status, updatedAt, updated_at: updatedAt } : r);
      return finalRequests;
    });
    
    await saveData(STORAGE_KEYS.REQUESTS, finalRequests);
    const targetReq = finalRequests.find(r => r.id === id);
    if (targetReq) {
      cloudStorage.upsertRequests([targetReq]).catch(console.error);
      if (targetReq.date === todayStr) {
        let newStatus: string | null = null;
        if (status === 'approved') {
          const leaveTypes = ['年休', '有給休暇', '時間休', '時間給', '看護休暇', '振替', '夏季休暇', '午前休', '午後休', '特休', '休暇', '欠勤', '長期休暇', '全休'];
          newStatus = leaveTypes.includes(targetReq.type) ? '休暇' : (targetReq.type === '出勤' ? '常勤' : null);
        } else {
          newStatus = '常勤';
        }
        if (newStatus) {
           handleUpdateStaffList(prevStaff => prevStaff.map(s => normalizeName(s.name) === normalizeName(targetReq.staffName!) ? { ...s, status: newStatus as any } : s));
        }
      }
    }
  };

  const handleUpdateProfile = async (newProfile: any) => {
    if (!newProfile) {
      setProfile(null);
      await AsyncStorage.removeItem(STORAGE_KEYS.PROFILE);
      return;
    }
    setProfile(newProfile);
    await saveData(STORAGE_KEYS.PROFILE, newProfile);
    const exists = staffList.find(s => normalizeName(s.name) === normalizeName(newProfile.name));
    if (!exists) handleUpdateStaffList(prev => [...prev, newProfile]);
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.PROFILE);
    setProfile(null);
    setIsAdminAuthenticated(false);
    setStaffViewMode(false);
    setCurrentTab('home');
    setShowSetup(false);
  };

  const handleUpdateLimits = async (type: string, val: number, monthStr?: string) => {
    const normalizedType = (type === 'public' || type === 'publicHoliday') ? 'publicHoliday' : type;
    if (monthStr) {
      const prevMonth = monthlyLimits[monthStr] || { weekday: weekdayLimit, sat: saturdayLimit, sun: sundayLimit, pub: publicHolidayLimit };
      const updated = { ...prevMonth };
      if (normalizedType === 'weekday') updated.weekday = val;
      if (normalizedType === 'saturday') updated.sat = val;
      if (normalizedType === 'sunday') updated.sun = val;
      if (normalizedType === 'publicHoliday') updated.pub = val;
      const newLimits = { ...monthlyLimits, [monthStr]: updated };
      setMonthlyLimits(newLimits);
      await saveData(STORAGE_KEYS.MONTHLY_LIMITS, newLimits);
      cloudStorage.saveConfig(STORAGE_KEYS.MONTHLY_LIMITS, newLimits).catch(console.error);
      return;
    }
    if (normalizedType === 'weekday') setWeekdayLimit(val);
    else if (normalizedType === 'saturday') setSaturdayLimit(val);
    else if (normalizedType === 'sunday') setSundayLimit(val);
    else if (normalizedType === 'publicHoliday') setPublicHolidayLimit(val);
    const key = normalizedType === 'weekday' ? STORAGE_KEYS.WEEKDAY_LIMIT : normalizedType === 'saturday' ? STORAGE_KEYS.SATURDAY_LIMIT : normalizedType === 'sunday' ? STORAGE_KEYS.SUNDAY_LIMIT : STORAGE_KEYS.PUBLIC_HOLIDAY_LIMIT;
    await saveData(key, val);
    cloudStorage.saveConfig(key, val).catch(console.error);
  };

  const handleUpdatePassword = (pass: string) => {
    setAdminPassword(pass);
    saveData(STORAGE_KEYS.ADMIN_PASSWORD, pass);
    cloudStorage.saveConfig(STORAGE_KEYS.ADMIN_PASSWORD, pass).catch(console.error);
  };

  const handleAutoAssign = async (year: number, month: number, limits: any) => {
    try {
      // 履歴を保存
      setRequestsHistory(prev => [...prev.slice(-4), [...requests]]);

      const response = await fetch('/api/ai-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffList,
          requests,
          limits: {
            weekday: limits?.weekday ?? weekdayLimit,
            saturday: limits?.sat ?? saturdayLimit,
            sunday: limits?.sun ?? sundayLimit,
            publicHoliday: limits?.pub ?? publicHolidayLimit
          },
          month,
          year
        })
      });

      const data = await response.json();
      if (!data.newRequests) throw new Error('自動割り当ての生成に失敗しました');

      // 各リクエストに一意のIDとタイムスタンプを付与
      const nowStr = new Date().toISOString();
      const newWithIds = data.newRequests.map((r: any) => ({
        ...r,
        id: r.id || `auto-${r.staffId}-${r.date}-${Math.random().toString(36).substr(2, 6)}`,
        createdAt: nowStr,
        status: r.status || 'approved'
      }));

      // 既存の自動割当分（auto- および過去の legacy ID：af-, aw-, plan-）を除去
      // ※必ず対象月（monthPrefix）に一致するものだけを削除対象とする
      const filteredRequests = requests.filter(r => {
        const idStr = String(r.id || '');
        const isAuto = idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-');
        const isTargetMonth = r.date && r.date.startsWith(monthPrefix);
        // 「自動割当ID」かつ「対象月」の場合のみ削除（それ以外は残す）
        return !(isAuto && isTargetMonth);
      });
      const updated = [...filteredRequests, ...newWithIds];
      
      setRequests(updated);
      await saveData(STORAGE_KEYS.REQUESTS, updated);
      await cloudStorage.upsertRequests(newWithIds);
    } catch (e) {
      console.error('Auto Assign Error:', e);
      throw e;
    }
  };

  const handleUndoAutoAssign = async () => {
    if (requestsHistory.length === 0) {
      Alert.alert('情報', '戻せる履歴がありません。');
      return;
    }

    const previous = requestsHistory[requestsHistory.length - 1];
    const current = [...requests];
    
    // 現在あって、履歴にないIDを特定して削除
    const prevIds = new Set(previous.map(r => String(r.id)));
    const toDelete = current.filter(r => !prevIds.has(String(r.id))).map(r => String(r.id));

    try {
      setIsSyncing(true);
      setRequests(previous);
      setRequestsHistory(prev => prev.slice(0, -1));
      
      await saveData(STORAGE_KEYS.REQUESTS, previous);
      
      if (toDelete.length > 0) {
        await cloudStorage.deleteRequests(toDelete);
      }
      
      // 履歴にある全データを再プッシュ（念のため）
      await cloudStorage.upsertRequests(previous);
      
      Alert.alert('完了', '一つ前の状態に戻しました。');
    } catch (e) {
      console.error('Undo failed:', e);
      Alert.alert('エラー', '元に戻す処理中にエラーが発生しました。');
    } finally {
      setIsSyncing(false);
    }
  };

  const renderContent = () => {
    const commonProps = {
      staffList, setStaffList: handleUpdateStaffList,
      requests, setRequests: handleUpdateRequests,
      onDeleteRequests: handleDeleteRequests,
      onDeleteRequest: handleDeleteRequest,
      approveRequest: handleApproveRequest,
      profile, setProfile: handleUpdateProfile,
      weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit,
      monthlyLimits, updateLimits: handleUpdateLimits,
      adminPassword, updatePassword: handleUpdatePassword,
      isAdminAuthenticated, setIsAdminAuthenticated,
      onOpenRequests: () => setCurrentTab('adminRequests'),
      onShareApp: () => setCurrentTab('qrShare'),
      onLogout: handleLogout,
      staffViewMode,
      setStaffViewMode: async (val: boolean) => { setStaffViewMode(val); await saveData(STORAGE_KEYS.STAFF_VIEW_MODE, val); },
      sessionDuration,
      setSessionDuration: async (val: number) => { setSessionDuration(val); await saveData(STORAGE_KEYS.SESSION_DURATION, val); },
      onForceCloudSync: handleForceCloudSync,
      currentDate: activeDate, setCurrentDate: setActiveDate,
      onAutoAssign: handleAutoAssign,
      onUndoAutoAssign: handleUndoAutoAssign,
      canUndoAutoAssign: requestsHistory.length > 0,
    };

    switch (currentTab) {
      case 'home': return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...commonProps} />;
      case 'calendar': return <CalendarScreen {...commonProps} />;
      case 'requests': return <RequestScreen {...commonProps} />;
      case 'staff': return <StaffScreen {...commonProps} isPrivileged={isAdminAuthenticated} />;
      case 'admin': return <AdminScreen {...commonProps} />;
      case 'adminRequests': return <AdminRequestScreen onBack={() => setCurrentTab('admin')} requests={requests} approveRequest={handleApproveRequest} deleteRequest={handleDeleteRequest} />;
      case 'qrShare': return <QrShareScreen onBack={() => setCurrentTab('admin')} />;
      default: return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...commonProps} />;
    }
  };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        {!profile ? (
          showSetup ? (
            <SetupScreen onComplete={handleUpdateProfile} onBack={() => setShowSetup(false)} />
          ) : (
            <LoginScreen staffList={staffList} onLogin={handleUpdateProfile} onGoToSetup={() => setShowSetup(true)} />
          )
        ) : profile.isApproved === false ? (
          <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
            <View style={{ width: '100%', alignItems: 'center' }}>
              <ThemeCard style={{ padding: 40, width: '100%', alignItems: 'center', borderRadius: 32 }}>
                <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.1)', padding: 24, borderRadius: 100, marginBottom: 24 }}>
                  <Shield size={48} color={COLORS.primary} />
                </View>
                <ThemeText variant="h1" style={{ marginBottom: 12, textAlign: 'center' }}>登録承認待ち</ThemeText>
                <ThemeText variant="body" color={COLORS.textSecondary} style={{ textAlign: 'center', lineHeight: 24, marginBottom: 32 }}>
                  {profile.name} さんの登録申請を送信しました。{"\n"}
                  管理者が承認するまで、しばらくお待ちください。{"\n"}
                  （承認後にアプリが利用可能になります）
                </ThemeText>
                
                <TouchableOpacity 
                  style={{ backgroundColor: COLORS.primary, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', opacity: isSyncing ? 0.7 : 1 }}
                  disabled={isSyncing}
                  onPress={async () => {
                    const success = await handleForceCloudSync();
                    if (success) {
                      Alert.alert('確認', '最新のステータスを確認しました。');
                    }
                  }}
                >
                  {isSyncing ? (
                    <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                  ) : (
                    <RefreshCw size={20} color="white" style={{ marginRight: 8 }} />
                  )}
                  <ThemeText bold color="white">{isSyncing ? '確認中...' : '最新の状態に更新'}</ThemeText>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={{ marginTop: 40 }}
                  onPress={handleLogout}
                >
                  <ThemeText color="#ef4444">入力をやり直す (ログアウト)</ThemeText>
                </TouchableOpacity>
              </ThemeCard>
            </View>
          </SafeAreaView>
        ) : (
          <>
            <View style={styles.content}>{renderContent()}</View>
            <SafeAreaView style={styles.tabBarContainer}>
              <View style={styles.tabBar}>
                {[
                  { id: 'home', icon: Home, label: 'ホーム' },
                  { id: 'calendar', icon: Calendar, label: '出勤' },
                  { id: 'staff', icon: Users, label: '職員' },
                  { id: 'requests', icon: ClipboardList, label: '申請' },
                  { id: 'admin', icon: (profile.role?.includes('管理者') || profile.role?.includes('開発者')) ? Shield : User, label: (profile.role?.includes('管理者') || profile.role?.includes('開発者')) ? '管理・設定' : '設定' }
                ].map(tab => (
                  <TouchableOpacity key={tab.id} style={styles.tabItem} onPress={() => setCurrentTab(tab.id)} activeOpacity={0.7}>
                    <tab.icon size={24} color={currentTab === tab.id ? COLORS.primary : COLORS.textSecondary} />
                    <ThemeText variant="caption" style={{ marginTop: 4, fontSize: 9, color: currentTab === tab.id ? COLORS.primary : COLORS.textSecondary }}>{tab.label}</ThemeText>
                  </TouchableOpacity>
                ))}
              </View>
            </SafeAreaView>
          </>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1 },
  tabBarContainer: { backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border },
  tabBar: { flexDirection: 'row', height: 60, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 8 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 8 },
});
