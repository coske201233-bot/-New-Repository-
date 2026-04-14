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
import { getDateStr, toDateStr } from './src/utils/dateUtils';

// Helper to ensure only one request per person per day, prioritizing manual edits
const deduplicateRequests = (list: any[]) => {
  if (!Array.isArray(list)) return { cleanList: [], discardedIds: [] };
  const map = new Map();
  const discardedIds: string[] = [];
  
  const getTime = (i: any) => {
    const t = i.updatedAt || i.updated_at || i.createdAt || i.created_at || 0;
    return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
  };

  const isLocked = (i: any) => i?.details?.locked === true || i?.locked === true;

  const isManual = (i: any) => {
    if (!i) return false;
    // ステータスが削除済みのものは手動・自動問わず除外対象
    if (i.status === 'deleted' || i.status === 'removed') return false;

    const idStr = String(i.id || '');
    // タイプ名や理由、備考をトリム（空白除去）して取得
    const type = String(i.type || '').trim();
    const reason = String(i.reason || '').trim();
    const note = String(i.details?.note || '').trim();
    
    // 【最優先】ID接頭辞判定 (m- または manual- は確実に手動)
    if (idStr.startsWith('m-') || idStr.startsWith('manual-') || idStr.startsWith('off-')) return true;

    // 振替系は手動
    if (type.includes('振替')) return true;
    
    // 確実なフラグ
    if (i.isManual === true || i.isManual === 'true' || i.isManual === 1 || i.details?.isManual === true) return true;
    
    // システム生成判定 (auto- 等で始まり、かつ「自動」という言葉が含まれる場合のみ自動。それ以外は手動扱い)
    if (idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('aw-') || idStr.startsWith('plan-')) {
      // 備考や理由に「自動」という言葉が含まれている場合は、たとえ手動フラグが立っていてもシステム生成とみなす（不整合防止）
      if (reason.includes('自動') || note.includes('自動')) return false;
      if (reason === '' && note === '') return false;
      return true;
    }

    // 休暇・振替系タイプ判定 (部分一致も許容)
    const leaveTypes = ['年休', '有給', '時間', '振替', '公休', '夏季', '特休', '休暇', '欠勤', '休'];
    if (leaveTypes.some(lt => type.includes(lt))) return true;
    
    const h = i.hours ?? i.details?.duration ?? i.duration;
    if (h !== undefined && h !== null && h !== 0 && h !== '0') return true;

    if (/^\d+$/.test(idStr) && !type.includes('出勤')) return true;

    return false;
  };

  list.forEach(item => {
    if (!item || !item.staffName || !item.date) return;
    // 削除済みステータスはスキップ
    if (item.status === 'deleted' || item.status === 'removed') {
      discardedIds.push(item.id);
      return;
    }
    if (!item.id) item.id = `temp-${item.staffName}-${item.date}-${Date.now()}`;
    
    // キーには「人-日」で一意にする（1日1件が基本だが、時間給などの併記は表示側でこなす）
    // ※ここをタイプまで含めると、同じ日に別タイプの「自動」と「手動」が両方残ってしまうため。
    // 手動と自動の競合をここで確実に解決する。
    const key = `${normalizeName(item.staffName)}-${item.date}`;
    const existing = map.get(key);

    const isLockNew = isLocked(item);
    const wasLockOld = existing ? isLocked(existing) : false;

    const isManNew = isManual(item);
    const wasManOld = existing ? isManual(existing) : false;

    let isPriority = false;
    if (!existing) {
      isPriority = true;
    } else {
      // 最優先ルール: 新しいデータが m- (ユーザー直接入力) であれば、既存のロック等に関わらず採用
      const isNewTrueManual = String(item.id || '').startsWith('m-');
      const wasOldTrueManual = String(existing.id || '').startsWith('m-');
      
      if (isNewTrueManual && !wasOldTrueManual) {
        isPriority = true;
      } else if (!isNewTrueManual && wasOldTrueManual) {
        isPriority = false;
      } else {
        // IDの接頭辞が同じ（両方 m- または両方それ以外）場合は、従来の優先順位（ロック > 手動 > 時間）
        if (isLockNew && !wasLockOld) {
          isPriority = true;
        } else if (!isLockNew && wasLockOld) {
          isPriority = false;
        } else if (isManNew && !wasManOld) {
          isPriority = true;
        } else if (!isManNew && wasManOld) {
          isPriority = false;
        } else {
          // それ以外は更新日時または承認ステータス優先
          const timeNew = getTime(item);
          const timeOld = getTime(existing);
          if (timeNew > timeOld) {
            isPriority = true;
          } else if (timeNew === timeOld) {
            isPriority = (item.status === 'approved' && existing.status !== 'approved');
          }
        }
      }
    }

    if (isPriority) {
      // 自己修復機能: 優先されたデータ(特に m-) が時間給タイプなのに時間が 0 の場合、
      // 適切なデフォルト値で補完する（前回の不整合データを引きずらないため）
      if (item.id && String(item.id).startsWith('m-')) {
        const h = item.hours ?? item.details?.hours ?? 0;
        if (h === 0 || h === '0') {
          if (['時間休', '特休', '看護休暇', '振替＋時間休'].includes(item.type)) {
            item.hours = 1.0;
            if (item.details) item.details.hours = 1.0;
          }
        }
      }

      if (existing && existing.id !== item.id) discardedIds.push(existing.id);
      map.set(key, item);
    } else {
      if (item.id !== existing.id) discardedIds.push(item.id);
    }
  });

  // 2次パス: 手動（公休等）がある日は同じ日の自動（auto等）を排除
  const tempResults = Array.from(map.values());
  const dayManuals = new Set();
  tempResults.forEach(r => { if (isManual(r)) dayManuals.add(`${normalizeName(r.staffName)}-${r.date}`); });

  const cleanList = tempResults.filter(r => {
    if (dayManuals.has(`${normalizeName(r.staffName)}-${r.date}`) && !isManual(r)) {
      if (!discardedIds.includes(r.id)) discardedIds.push(r.id);
      return false;
    }
    return true;
  });

  return { cleanList, discardedIds };
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
  const [validationErrors, setValidationErrors] = useState<any[]>([]);

  // スケジュール整合性チェック
  const validateSchedule = (reqs: any[], staffs: any[], lims: any) => {
    const errors: any[] = [];
    const staffMap = new Map();
    staffs.forEach(s => staffMap.set(normalizeName(s.name), s));

    const workingTerms = ['出勤', '日勤', '勤務', '通常', '午前休', '午後休', '午前振替', '午後振替', '時間休', '特休', '看護休暇'];
    const isWorking = (type: string) => workingTerms.some(t => type?.includes(t));

    // 1. 休日リミットチェック
    const holidayCounts: { [date: string]: string[] } = {};
    reqs.forEach(r => {
      if (r.status === 'deleted') return;
      const d = new Date(r.date.replace(/-/g, '/'));
      const isHol = d.getDay() === 0 || d.getDay() === 6; // 土日
      // 祝日判定（本当はJAPAN_HOLIDAYSが必要だがアプリ全体の挙動に合わせる）
      if (isHol && isWorking(r.type)) {
        holidayCounts[r.date] = holidayCounts[r.date] || [];
        holidayCounts[r.date].push(r.staffName);
      }
    });

    Object.entries(holidayCounts).forEach(([date, names]) => {
      const d = new Date(date.replace(/-/g, '/'));
      const dow = d.getDay();
      const limit = dow === 0 ? (lims.sun || 2) : (lims.sat || 2);
      if (names.length > limit) {
        errors.push({ type: 'limit', date, message: `${date} の出勤者が ${names.length}名 で上限(${limit}名)を超えています [${names.join(', ')}]` });
      }
    });

    // 2. 連勤チェック (Max 5)
    const staffHistory: { [name: string]: any[] } = {};
    reqs.forEach(r => {
      if (r.status === 'deleted') return;
      const name = normalizeName(r.staffName);
      staffHistory[name] = staffHistory[name] || [];
      staffHistory[name].push({ date: r.date, working: isWorking(r.type) });
    });

    Object.entries(staffHistory).forEach(([name, history]) => {
      history.sort((a, b) => a.date.localeCompare(b.date));
      let streak = 0;
      let lastDate: Date | null = null;
      history.forEach(h => {
        const currentDate = new Date(h.date.replace(/-/g, '/'));
        if (h.working) {
          if (lastDate && (currentDate.getTime() - lastDate.getTime()) / 86400000 === 1) streak++;
          else streak = 1;
          if (streak > 5) {
            const staff = staffMap.get(name);
            errors.push({ type: 'streak', staffName: staff?.name || name, date: h.date, streak, message: `${staff?.name || name} さんが ${h.date} 時点で ${streak}連勤 になっています` });
          }
          lastDate = currentDate;
        } else {
          streak = 0;
          lastDate = currentDate;
        }
      });
    });

    setValidationErrors(errors);
  };
  const [activeDate, setActiveDate] = useState(new Date());
  const [requestsHistory, setRequestsHistory] = useState<any[][]>([]);
  const [staffLocks, setStaffLocks] = useState<Record<string, Record<string, boolean>>>({});

  // 変更があるたびにルール検証を実行
  useEffect(() => {
    validateSchedule(requests, staffList, { sat: saturdayLimit, sun: sundayLimit });
  }, [requests, staffList, saturdayLimit, sundayLimit]);

  // Initial Load (Cloud Sync Integrated)
  useEffect(() => {
    // ウェブ版でChromeの自動翻訳（公休→休みなど）を防止する設定
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.lang = 'ja';
    }

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
            const merged = cloudStaff.map((cs: any) => {
              const localMatch = (localStaff || []).find((ls: any) => String(ls.id) === String(cs.id));
              const n = { ...cs, name: normalizeName(cs.name) };
              // ロック情報を統合
              n.lockedMonths = { ...(cs.lockedMonths || {}), ...(localMatch?.lockedMonths || {}) };
              if (n.status === '休暇' || n.status === '全休') n.status = '常勤';
              return n;
            });
            const sorted = sortStaffByName(merged);
            setStaffList(sorted);
            await saveData(STORAGE_KEYS.STAFF_LIST, sorted);
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
        
        // ロック情報の読み込み
        try {
          const cloudLocks = await cloudStorage.fetchConfig('staff_locks');
          if (cloudLocks) setStaffLocks(cloudLocks);
        } catch (e) {}
        
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
    if (isSyncing) return;
    setIsSyncing(true);
    
    try {
      const prevRequests = requests;
      const next = typeof update === 'function' ? update(prevRequests) : update;
      const validOnly = (next || []).filter((r: any) => r && r.staffName && r.date);
      
      const now = new Date().toISOString();
      const processed = validOnly.map(r => {
        const id = r.id || `m-${r.staffName}-${r.date}-${Math.random().toString(36).substr(2, 9)}`;
        const existing = prevRequests.find(p => p.id === id);
        const isChanged = !existing || existing.type !== r.type || existing.status !== r.status || existing.date !== r.date;
        
        if (isChanged) {
          return { ...r, id, updatedAt: now };
        }
        return { ...r, id };
      });

      const { cleanList: validatedList } = deduplicateRequests(processed);
      
      // 変更があったレコードだけを抽出してクラウドに送る
      const changedRecords = validatedList.filter(nr => {
        const old = prevRequests.find(o => o.id === nr.id);
        if (!old) return true;
        return old.type !== nr.type || old.status !== nr.status || old.date !== nr.date;
      });

      setRequests(validatedList);
      await saveData(STORAGE_KEYS.REQUESTS, validatedList);
      
      if (changedRecords.length > 0) {
        await cloudStorage.upsertRequests(changedRecords);
      }
    } catch (err) {
      console.error('UpdateRequests failed:', err);
    } finally {
      setIsSyncing(false);
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
        const currentLocalStaff = await loadData(STORAGE_KEYS.STAFF_LIST) || [];
        const merged = cloudStaff.map((cs: any) => {
          const localMatch = currentLocalStaff.find((ls: any) => String(ls.id) === String(cs.id));
          const n = { ...cs, name: normalizeName(cs.name) };
          n.lockedMonths = { ...(cs.lockedMonths || {}), ...(localMatch?.lockedMonths || {}) };
          return n;
        });
        const sorted = sortStaffByName(merged);
        setStaffList(sorted);
        await saveData(STORAGE_KEYS.STAFF_LIST, sorted);
        
        if (profile) {
          const latest = merged.find((s: any) => String(s.id) === String(profile.id));
          if (latest) setProfile(latest);
        }
      }

      // 2. リクエスト情報の取得・マージ・双方向同期
      const cloudRequests = await cloudStorage.fetchRequests();
      // クロージャの古いstateを参照しないよう、常に最新のローカルデータを取得する
      const localRequests = await loadData(STORAGE_KEYS.REQUESTS) || [];
      
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
          const leaveTypes = ['年休', '有給休暇', '時間休', '看護休暇', '振替', '夏季休暇', '午前休', '午後休', '特休', '休暇', '欠勤', '長期休暇', '全休'];
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

      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      if (!data.newRequests) throw new Error('自動割り当ての生成に失敗しました');

      const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
      const nowStr = new Date().toISOString();
      const newWithIds = data.newRequests.map((r: any) => ({
        ...r,
        id: r.id || `auto-${r.staffId}-${r.date}-${Math.random().toString(36).substr(2, 6)}`,
        createdAt: nowStr,
        status: r.status || 'approved'
      })).filter((r: any) => {
        const staff = staffList.find(s => String(s.id) === String(r.staffId));
        return !(staff?.lockedMonths?.[monthPrefix]);
      });

      const oldAutoRequests = requests.filter(r => {
        const idStr = String(r.id || '');
        const isAutoId = idStr.startsWith('auto-') || idStr.startsWith('af-') || idStr.startsWith('ah-') || idStr.startsWith('aw-') || idStr.startsWith('plan-');
        const isTargetMonth = r.date && r.date.startsWith(monthPrefix);
        
        // 当該月・当該スタッフがロックされている場合は、自動割当データであっても削除せずに残す（上書き防止）
        const staff = staffList.find(s => String(s.id) === String(r.staffId));
        const isLocked = staff?.lockedMonths?.[monthPrefix] === true;
        
        // 追加判定：自動IDであっても、理由や備考に「自動」が含まれないものは手動で調整されたとみなして削除しない
        const reason = String(r.reason || '').trim();
        const note = String(r.details?.note || '').trim();
        const isActuallyAuto = isAutoId && (reason.includes('自動') || note.includes('自動') || (reason === '' && note === ''));

        // 「（真に）自動割当データ」かつ「対象月」かつ「ロックされていない」場合のみ削除対象
        return isActuallyAuto && isTargetMonth && !isLocked;
      });

      const oldAutoIds = oldAutoRequests.map((r: any) => String(r.id));
      const filteredRequests = requests.filter((r: any) => !oldAutoIds.includes(String(r.id)));

      const updated = [...filteredRequests, ...newWithIds];
      setRequests(updated);
      await saveData(STORAGE_KEYS.REQUESTS, updated);
      
      // クラウド側の古い自動割り当てデータを削除
      if (oldAutoIds.length > 0) {
        await cloudStorage.deleteRequests(oldAutoIds).catch(console.error);
      }

      if (newWithIds.length > 0) {
        await cloudStorage.upsertRequests(newWithIds);
      }
    } catch (e) {
      console.error('Auto Assign Error:', e);
      Alert.alert('割り当てエラー', '通信に失敗しました。');
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
      staffLocks,
        setStaffLocks: async (newLocks: any) => {
          setStaffLocks(newLocks);
          await cloudStorage.saveConfig('staff_locks', newLocks).catch(console.error);
        },
        validationErrors
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
