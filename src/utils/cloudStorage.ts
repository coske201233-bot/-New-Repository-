import { supabase } from './supabase';
import { Alert } from 'react-native';

// Helpers to map between camelCase (JS) and snake_case (SQL)
const mapToSql = (obj: any, mapping: Record<string, string>) => {
  const result: any = {};
  for (const key in obj) {
    const sqlKey = mapping[key] || key;
    let val = obj[key];
    // Ensure 'role' is stored as a string even if passed as an array (data type safety)
    if (key === 'role' && Array.isArray(val)) val = val.join(',');
    result[sqlKey] = val;
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
const REQ_MAP = { staffName: 'staff_name', staffId: 'staff_id', createdAt: 'created_at' };
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
    const validKeys = [
      'id', 'name', 'placement', 'position', 'status', 'profession', 'role', 
      'noHoliday', 'phone', 'password', 'createdAt', 'isApproved', 'pin',
      'isLocked', 'lockedMonths'
    ];
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
    // 取得上限を大幅に引き上げ
    // status が deleted のものは取得しない（ゾンビデータ復活防止）
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .neq('status', 'deleted')
      .limit(100000);
    if (error) throw error;
    return data.map(r => {
      const mapped = mapFromSql(r, REQ_MAP);
      const d = mapped.details || {};
      
      // details内に埋め込まれた情報をトップレベルに復元
      if (d.updatedAt) mapped.updatedAt = d.updatedAt;
      if (d.source) mapped.source = d.source;
      if (d.isManual !== undefined) mapped.isManual = d.isManual;
      if (d.priority !== undefined) mapped.priority = d.priority;
      if (d.locked !== undefined) mapped.locked = d.locked;
      if (d.hours !== undefined) mapped.hours = d.hours;
      
      // 時間数(hours)の復元（互換性維持：durationなどもチェック）
      const rawDuration = mapped.hours ?? d.duration ?? mapped.duration;
      if (rawDuration !== undefined && rawDuration !== null && rawDuration !== '') {
        const parsed = parseFloat(String(rawDuration));
        mapped.hours = isNaN(parsed) ? (mapped.type === '半日振替' ? 3.75 : 1.0) : parsed;
      } else {
        // デフォルト値のフォールバック
        if (mapped.type === '半日振替') mapped.hours = 3.75;
        else if (['時間休', '特休', '看護休暇', '振替＋時間休'].includes(mapped.type)) mapped.hours = 1.0;
        else mapped.hours = 0;
      }
      return mapped;
    });
  },
  async upsertRequests(requests: any[]) {
    if (!requests || requests.length === 0) return;

    // 1. 最新のクラウド状態を取得して比較する（Safe-Upsert）
    const targetIds = requests.map(r => r.id);
    const { data: cloudItems } = await supabase
      .from('requests')
      .select('id, details')
      .in('id', targetIds);

    const cloudUpdateMap = new Map();
    if (cloudItems) {
      cloudItems.forEach(item => {
        const uAt = item.details?.updatedAt || item.details?.updated_at || 0;
        cloudUpdateMap.set(item.id, typeof uAt === 'string' ? new Date(uAt).getTime() : 0);
      });
    }

    const filtered = requests.filter(r => {
      const clientTime = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
      const cloudTime = cloudUpdateMap.get(r.id) || 0;
      
      // クライアント側が「新しい」または「同等（レガシーデータ含む）」の場合、
      // あるいはクラウドに存在しない場合に保存を許可
      return clientTime >= cloudTime;
    }).map(r => {
      const obj: any = {};
      const validKeys = ['id', 'staffName', 'staffId', 'date', 'type', 'status', 'details', 'reason', 'createdAt'];
      
      const details = { ...(r.details || {}) };
      if (r.updatedAt) details.updatedAt = r.updatedAt;
      if (r.source) details.source = r.source;
      if (r.isManual !== undefined) details.isManual = r.isManual;
      if (r.priority !== undefined) details.priority = r.priority;
      if (r.hours !== undefined) details.hours = r.hours;
      if (r.locked !== undefined) details.locked = r.locked;
      
      const payload = { ...r, details };
      validKeys.forEach(k => { if (payload[k] !== undefined) obj[k] = payload[k]; });
      return mapToSql(obj, REQ_MAP);
    });

    if (filtered.length === 0) {
      console.log('No newer requests to sync. Skipping upsert.');
      return;
    }

    const { error } = await supabase.from('requests').upsert(filtered, { onConflict: 'id' });
    if (error) {
       console.error('Requests sync error:', error);
       throw error;
    }
    console.log(`${filtered.length} requests synced to cloud successfully (Safe-Upsert)`);
  },
  async upsertSingleRequest(r: any) {
    // 安全のため、単一更新も共通の Safe-Upsert ロジックを通す
    await this.upsertRequests([r]);
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

  /**
   * 特定の月のリクエストを物理削除、またはステータス変更でクリアします
   * ゾンビデータの完全排除のために物理削除を優先します
   */
  async clearRequestsForMonth(monthPrefix: string) {
    console.log(`Clearing global requests for: ${monthPrefix}`);
    const { error } = await supabase
      .from('requests')
      .delete()
      .like('date', `${monthPrefix}%`);
    
    if (error) {
      console.error('Clear requests error:', error);
      throw error;
    }
  },

  /**
   * 現在の全リクエストをクラウドに強制保存します（Source of Truth の確立）
   * 盲目的な全上書きを防止するため、Smart-Sync (Merge) を実行します
   */
  async forceStoreRequests(requests: any[]) {
    console.log('Performing Smart-Sync for all requests...');
    
    // 1. まずクラウドの全データを取得
    const cloudReqs = await this.fetchRequests();
    
    // 2. クラウドデータとローカルデータを重複排除ロジックでマージ
    // (循環参照を避けるため、動的インポートまたは共通ユーティリティを使用)
    const { deduplicateRequests } = require('./requestUtils');
    const { cleanList } = deduplicateRequests([...cloudReqs, ...requests]);
    
    // 3. マージ後の結果を Safe-Upsert で保存
    if (cleanList.length === 0 && requests.length > 0) {
      console.warn('Smart-Sync resulted in empty list while input was not empty. Cancellation for safety.');
      return;
    }
    await this.upsertRequests(cleanList);
    console.log(`Smart-Sync completed. Resulting in ${cleanList.length} unified requests.`);
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
