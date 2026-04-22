import { useState, useEffect, useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage, mapToSql, mapFromSql, STAFF_MAP } from '../utils/cloudStorage';
import { sortStaffByName } from '../utils/staffUtils';

export const useStaffData = () => {
  const [staffList, setStaffList] = useState<any[]>([]);
  const [staffLocks, setStaffLocks] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    const load = async () => {
      const ls = await loadData(STORAGE_KEYS.STAFF_LIST);
      if (ls) setStaffList(sortStaffByName(ls));
    };
    load();
  }, []);

  const updateStaffList = useCallback(async (update: any[] | ((prev: any[]) => any[])) => {
    try {
      const currentStaffSnap = Array.isArray(staffList) ? staffList : [];
      const next = typeof update === 'function' ? update(currentStaffSnap) : update;
      
      if (!Array.isArray(next)) return;
      
      const sorted = sortStaffByName(next.filter((s: any) => s && s.name));
      
      // 1. Cloud Upsert FIRST
      if (sorted.length > 0) {
        await cloudStorage.upsertStaff(sorted);
      }

      // 2. React State and Local Storage SECOND
      setStaffList(sorted);
      await saveData(STORAGE_KEYS.STAFF_LIST, sorted);
      
      return sorted;
    } catch (e) {
      console.error('Staff Update Error (Persistence Failed):', e);
      throw e;
    }
  }, []);

  const updateStaffLocks = useCallback(async (l: any) => {
    setStaffLocks(l);
  }, []);

  const patchStaff = useCallback(async (id: string, updates: any) => {
    try {
      const sqlUpdates = mapToSql(updates, STAFF_MAP);
      const { data, error } = await supabase.from('staff').update(sqlUpdates).eq('id', id).select();
      if (error) {
        console.error("UPDATE ERROR:", error);
        Alert.alert("保存に失敗しました", (error.message || "不明なエラー") + "\n" + (error.details || ""));
        throw error;
      }
      
      // Update local state
      const jsUpdated = mapFromSql(data[0], STAFF_MAP);
      setStaffList(prev => prev.map(s => s.id === id ? { ...s, ...jsUpdated } : s));
      
      // Sync to local storage
      const updatedList = staffList.map(s => s.id === id ? { ...s, ...jsUpdated } : s);
      await saveData(STORAGE_KEYS.STAFF_LIST, updatedList);
      
      return jsUpdated;
    } catch (e) {
      console.error('Staff Patch Error:', e);
      throw e;
    }
  }, [staffList]);

  const syncStaffWithCloud = useCallback(async () => {
    try {
      const cloudStaff = await cloudStorage.fetchStaff();
      if (cloudStaff && cloudStaff.length > 0) {
        const sorted = sortStaffByName(cloudStaff);
        setStaffList(sorted);
        await saveData(STORAGE_KEYS.STAFF_LIST, sorted);
        return sorted;
      }
    } catch (e) {
      console.error('Sync Staff Error:', e);
    }
    return null;
  }, []);

  return useMemo(() => ({ 
    staffList, setStaffList, staffLocks, setStaffLocks, updateStaffList, patchStaff, updateStaffLocks, syncStaffWithCloud 
  }), [staffList, staffLocks, updateStaffList, patchStaff, updateStaffLocks, syncStaffWithCloud]);
};
