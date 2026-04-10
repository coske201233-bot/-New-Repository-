import { supabase } from './supabase';
import { Alert } from 'react-native';

// Helpers to map between camelCase (JS) and snake_case (SQL)
const mapToSql = (obj: any, mapping: Record<string, string>) => {
  const result: any = {};
  for (const key in obj) {
    const sqlKey = mapping[key] || key;
    result[sqlKey] = obj[key];
  }
  return result;
};

const mapFromSql = (obj: any, mapping: Record<string, string>) => {
  const result: any = {};
  // Reverse the mapping
  const reverseMapping: Record<string, string> = {};
  for (const key in mapping) reverseMapping[mapping[key]] = key;

  for (const key in obj) {
    const jsKey = reverseMapping[key] || key;
    result[jsKey] = obj[key];
  }
  return result;
};

const STAFF_MAP = { noHoliday: 'no_holiday', createdAt: 'created_at', isApproved: 'is_approved', pin: 'pin', isLocked: 'is_locked', lockedMonths: 'locked_months' };
const REQ_MAP = { staffName: 'staff_name', createdAt: 'created_at' };
const MSG_MAP = { fromId: 'from_id', fromName: 'from_name', toId: 'to_id', createdAt: 'created_at' };

export const cloudStorage = {
  // --- Staff ---
  async fetchStaff() {
    try {
      const { data, error } = await supabase.from('staff').select('*').limit(10000);
      if (error) throw error;
      const result = data.map(s => mapFromSql(s, STAFF_MAP));
      if (typeof window !== 'undefined' && result.length > 0) {
        // Only alert on PC or non-init fetch if we want to confirm connection
        console.log('Fetched staff from cloud:', result.length);
      }
      return result;
    } catch (err) {
      console.error('Fetch staff error:', err);
      return [];
    }
  },
  async upsertStaff(staff: any[]) {
    const validKeys = ['id', 'name', 'placement', 'position', 'status', 'profession', 'role', 'noHoliday', 'phone', 'password', 'createdAt', 'isApproved', 'pin'];
    const filtered = staff.map(s => {
      const obj: any = {};
      validKeys.forEach(k => { if (s[k] !== undefined) obj[k] = s[k]; });
      return mapToSql(obj, STAFF_MAP);
    });
    const { error } = await supabase.from('staff').upsert(filtered, { onConflict: 'id' });
    if (error) {
      console.error('Staff sync error:', error);
      Alert.alert('クラウド保存失敗', error.message);
      throw error;
    }
    console.log('Staff synced to cloud successfully');
  },
  async upsertSingleStaff(s: any) {
    const validKeys = ['id', 'name', 'placement', 'position', 'profession', 'status', 'noHoliday', 'isApproved', 'role', 'password', 'isLocked', 'lockedMonths'];
    const obj: any = {};
    validKeys.forEach(k => { if (s[k] !== undefined) obj[k] = s[k]; });
    const { error } = await supabase.from('staff').upsert(mapToSql(obj, STAFF_MAP), { onConflict: 'id' });
    if (error) throw error;
  },
  async deleteStaff(id: number | string) {
    const { error } = await supabase.from('staff').delete().eq('id', id);
    if (error) {
      console.error('Staff deletion error:', error);
      throw error;
    }
    console.log('Staff deleted from cloud');
  },

  // --- Requests ---
  async fetchRequests() {
    // 取得上限を大幅に引き上げ（将来的に期間フィルタリングを推奨）
    const { data, error } = await supabase.from('requests').select('*').limit(100000);
    if (error) throw error;
    return data.map(r => {
      const mapped = mapFromSql(r, REQ_MAP);
      // details内に埋め込まれたタイムスタンプや保護フラグがあればトップレベルに復元
      if (mapped.details?.updatedAt) {
        mapped.updatedAt = mapped.details.updatedAt;
      }
      if (mapped.details?.isManual !== undefined) {
        mapped.isManual = mapped.details.isManual;
      }
      if (mapped.details?.priority) {
        mapped.priority = mapped.details.priority;
      }
      // 時間数(hours)の復元
      const rawDuration = mapped.hours ?? mapped.details?.duration ?? mapped.duration;
      if (rawDuration !== undefined && rawDuration !== null && rawDuration !== '') {
        const parsed = parseFloat(String(rawDuration));
        mapped.hours = isNaN(parsed) ? (mapped.type === '半日振替' ? 3.75 : 1.0) : parsed;
      } else {
        // デフォルト値のフォールバック
        if (mapped.type === '半日振替') mapped.hours = 3.75;
        else if (['時間給', '時間休', '特休', '看護休暇'].includes(mapped.type)) mapped.hours = 1.0;
      }
      return mapped;
    });
  },
  async upsertRequests(requests: any[]) {
    const filtered = requests.map(r => {
      const obj: any = {};
      const validKeys = ['id', 'staffName', 'date', 'type', 'status', 'details', 'reason', 'createdAt'];
      
      // updatedAt, isManual, priority を details の中に確実に保存する（DBに列がないため）
      const details = { ...(r.details || {}) };
      if (r.updatedAt) details.updatedAt = r.updatedAt;
      if (r.isManual !== undefined) details.isManual = r.isManual;
      if (r.priority) details.priority = r.priority;
      r.details = details;
      
      validKeys.forEach(k => { if (r[k] !== undefined) obj[k] = r[k]; });
      return mapToSql(obj, REQ_MAP);
    });
    const { error } = await supabase.from('requests').upsert(filtered, { onConflict: 'id' });
    if (error) {
       console.error('Requests sync error:', error);
       throw error;
    }
    console.log('Requests synced to cloud successfully');
  },
  async upsertSingleRequest(r: any) {
    const validKeys = ['id', 'staffName', 'staffId', 'date', 'type', 'status', 'details', 'reason', 'createdAt'];
    const details = { ...(r.details || {}) };
    if (r.updatedAt) details.updatedAt = r.updatedAt;
    if (r.isManual !== undefined) details.isManual = r.isManual;
    if (r.priority) details.priority = r.priority;
    r.details = details;
    
    const obj: any = {};
    validKeys.forEach(k => { if (r[k] !== undefined) obj[k] = r[k]; });
    const { error } = await supabase.from('requests').upsert(mapToSql(obj, REQ_MAP), { onConflict: 'id' });
    if (error) throw error;
  },
  async deleteRequest(id: string) {
    const { error } = await supabase.from('requests').delete().eq('id', id);
    if (error) {
      console.error('Request deletion error:', error);
      throw error;
    }
  },
  async deleteRequests(ids: string[]) {
    if (!ids || ids.length === 0) return;
    // URL length limit prevention (chunk into 50 ids at a time)
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { error } = await supabase.from('requests').delete().in('id', chunk);
      if (error) throw error;
    }
  },

  // --- Realtime ---
  subscribeToChanges(callback: () => void) {
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => {
        console.log('Cloud data changed, triggering sync...');
        callback();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, () => {
        callback();
      })
      .subscribe();
    return channel;
  },
  unsubscribe(channel: any) {
    supabase.removeChannel(channel);
  },

  // --- Messages ---
  async fetchMessages() {
    const { data, error } = await supabase.from('messages').select('*').order('created_at', { ascending: true }).limit(5000);
    if (error) throw error;
    return data.map(m => mapFromSql(m, MSG_MAP));
  },
  async pushMessage(msg: any) {
    const validKeys = ['id', 'fromId', 'fromName', 'toId', 'content', 'type', 'attachments', 'createdAt'];
    const filtered: any = {};
    validKeys.forEach(k => { if (msg[k] !== undefined) filtered[k] = msg[k]; });
    const sqlObj = mapToSql(filtered, MSG_MAP);
    const { error } = await supabase.from('messages').insert([sqlObj]);
    if (error) {
      console.error('Message sync error:', error);
      throw error;
    }
  },
  async deleteMessagesBetween(user1: string, user2: string) {
    const { error } = await supabase.from('messages').delete()
      .or(`and(from_name.eq.${user1},to_id.eq.${user2}),and(from_name.eq.${user2},to_id.eq.${user1})`);
    if (error) throw error;
  },

  // --- Config ---
  async fetchConfig(key: string) {
    const { data, error } = await supabase.from('app_config').select('value').eq('key', key).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data?.value;
  },
  async saveConfig(key: string, value: any) {
    const { error } = await supabase.from('app_config').upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
  }
};
