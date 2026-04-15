// @ts-nocheck
import { useState, useCallback, useEffect } from 'react';
import { Platform, Alert, AppState } from 'react-native';
import { useAuthSession } from './useAuthSession';
import { useStaffData } from './useStaffData';
import { useRequestData } from './useRequestData';
import { useConfigData } from './useConfigData';
import { cloudStorage } from '../utils/cloudStorage';
import { STORAGE_KEYS, saveData } from '../utils/storage';
import { normalizeName } from '../utils/staffUtils';
import { deduplicateRequests } from '../utils/requestUtils';
import { getDateStr } from '../utils/dateUtils';
import { APP_CONFIG } from '../constants/Config';

export const useAppLogic = () => {
  const [currentTab, setCurrentTab] = useState('home');
  const [showSetup, setShowSetup] = useState(false);
  const [activeDate, setActiveDate] = useState(new Date());
  const [isSyncing, setIsSyncing] = useState(false);

  const auth = useAuthSession();
  const staff = useStaffData();
  const req = useRequestData();
  const config = useConfigData();

  const handleForceCloudSync = useCallback(async (isBackground = false) => {
    if (isSyncing) return false;
    setIsSyncing(true);
    try {
      const cloudReqs = await cloudStorage.fetchRequests();
      if (cloudReqs) req.setRequests(cloudReqs);
      await staff.syncStaffWithCloud();
      return true;
    } catch (e) { return false; } finally { setIsSyncing(false); }
  }, [isSyncing, req, staff]);

  const handleForceSave = async () => {
    setIsSyncing(true);
    try {
      await cloudStorage.forceStoreRequests(req.requests);
      if (Platform.OS === 'web') window.alert('✅ 保存完了');
      else Alert.alert('✅ 完了', '保存しました');
    } catch (e) { } finally { setIsSyncing(false); }
  };

  const handleForceFetch = async () => {
    setIsSyncing(true);
    try {
      const cr = await cloudStorage.fetchRequests();
      if (cr) req.setRequests(cr);
      await staff.syncStaffWithCloud();
      if (Platform.OS === 'web') window.alert('✅ 更新完了');
      else Alert.alert('✅ 完了', '更新しました');
    } catch (e) { } finally { setIsSyncing(false); }
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

  useEffect(() => {
    staff.syncStaffWithCloud();
  }, []);

  return {
    ...auth, ...staff, ...req, ...config,
    currentTab, setCurrentTab, showSetup, setShowSetup, activeDate, setActiveDate, isSyncing,
    handleForceCloudSync, handleForceSave, handleForceFetch,
    onAutoAssign, onUndoAutoAssign, onDeleteRequests,
    onDeleteRequest: (id: string) => onDeleteRequests([id]),
    onShareApp: () => setCurrentTab('qrShare'),
    canUndoAutoAssign: req.requestsHistory.length > 0
  };
};
