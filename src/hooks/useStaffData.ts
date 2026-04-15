import { useState, useEffect } from 'react';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage } from '../utils/cloudStorage';
import { sortStaffByName } from '../utils/staffUtils';

export const useStaffData = () => {
  const [staffList, setStaffList] = useState<any[]>([]);
  const [staffLocks, setStaffLocks] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    const load = async () => {
      const ls = await loadData(STORAGE_KEYS.STAFF_LIST);
      if (ls) setStaffList(sortStaffByName(ls));
      const cl = await cloudStorage.fetchConfig('staff_locks');
      if (cl) setStaffLocks(cl);
    };
    load();
  }, []);

  const updateStaffList = async (update: any[] | ((prev: any[]) => any[])) => {
    const next = typeof update === 'function' ? update(staffList) : update;
    const sorted = sortStaffByName(next.filter((s: any) => s && s.name));
    setStaffList(sorted);
    await saveData(STORAGE_KEYS.STAFF_LIST, sorted);
    if (sorted.length > 0) await cloudStorage.upsertStaff(sorted);
  };

  const updateStaffLocks = async (l: any) => {
    setStaffLocks(l);
    await cloudStorage.saveConfig('staff_locks', l).catch(console.error);
  };

  const syncStaffWithCloud = async () => {
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
  };

  return { staffList, setStaffList, staffLocks, setStaffLocks, updateStaffList, updateStaffLocks, syncStaffWithCloud };
};
