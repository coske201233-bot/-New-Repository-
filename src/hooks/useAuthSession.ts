import { useState, useEffect } from 'react';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage } from '../utils/cloudStorage';
import { sortStaffByName, normalizeName } from '../utils/staffUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const useAuthSession = () => {
  const [profile, setProfile] = useState<any>(null);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(24);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const dur = await loadData(STORAGE_KEYS.SESSION_DURATION);
        if (dur) setSessionDuration(dur);
        const sp = await loadData(STORAGE_KEYS.PROFILE);
        if (sp) {
          const now = Date.now();
          if (now - (sp.lastLoginTimestamp || 0) > (dur || 24) * 3600000) {
            await AsyncStorage.removeItem(STORAGE_KEYS.PROFILE);
          } else {
            setProfile(sp);
            if (sp.role?.includes('管理者') || sp.role?.includes('開発者')) setIsAdminAuthenticated(true);
          }
        }
      } catch (e) {} finally { setIsInitialized(true); }
    };
    init();
  }, []);

  const handleUpdateProfile = async (p: any) => {
    if (!p) {
      setProfile(null);
      await AsyncStorage.removeItem(STORAGE_KEYS.PROFILE);
      return;
    }
    const updated = { ...p, lastLoginTimestamp: Date.now() };
    setProfile(updated);
    await saveData(STORAGE_KEYS.PROFILE, updated);
    if (p.role?.includes('管理者') || p.role?.includes('開発者')) setIsAdminAuthenticated(true);
  };

  const logout = async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.PROFILE);
    setProfile(null);
    setIsAdminAuthenticated(false);
  };

  return { profile, setProfile, isAdminAuthenticated, setIsAdminAuthenticated, sessionDuration, setSessionDuration, isInitialized, handleUpdateProfile, logout };
};
