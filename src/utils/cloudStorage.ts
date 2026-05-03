import { supabase } from './supabase';
import { deduplicateRequests } from './requestUtils';
import { Alert } from 'react-native';

// Helpers to map between camelCase (JS) and snake_case (SQL)
export const mapToSql = (obj: any, mapping: Record<string, string>) => {
  if (!obj || typeof obj !== 'object') return {};
  const result: any = {};
  for (const key in obj) {
    const sqlKey = mapping[key] || key;
    let val = obj[key];
    if (val === undefined) continue;
    if (key === 'role' && Array.isArray(val)) val = val.join(',');
    result[sqlKey] = val;
  }
  return result;
};

export const mapFromSql = (obj: any, mapping: Record<string, string>) => {
  if (!obj || typeof obj !== 'object') return {};
  const result: any = {};
  const reverseMapping: Record<string, string> = {};
  for (const key in mapping) reverseMapping[mapping[key]] = key;

  for (const key in obj) {
    const jsKey = reverseMapping[key] || key;
    result[jsKey] = obj[key];
  }
  return result;
};

export const STAFF_MAP = { 
  jobType: 'profession',
  role: 'position',
  permissions: 'role',
  noHoliday: 'no_holiday', 
  createdAt: 'created_at', 
  isApproved: 'is_approved', 
  pin: 'pin', 
  userId: 'user_id', 
  isLocked: 'is_locked', 
  lockedMonths: 'locked_months' 
};
const REQ_MAP = { staffName: 'staff_name', staffId: 'staff_id', staff_id: 'staff_id', userId: 'user_id', createdAt: 'created_at' };
const MSG_MAP = { fromId: 'from_id', fromName: 'from_name', toId: 'to_id', createdAt: 'created_at' };

import { normalizeName } from './dateUtils';

export const cloudStorage = {
  // --- Staff ---
  async fetchStaff() {
    try {
      const { data, error } = await supabase.from('staff').select('*').limit(10000);
      if (error) throw error;
      const result = (data || []).map(s => mapFromSql(s, STAFF_MAP));
      if (typeof window !== 'undefined' && result.length > 0) {
        // Only alert on PC or non-init fetch if we want to confirm connection
        console.log('Fetched staff from cloud:', result.length);
      }
      return result;
    } catch (err: any) {
      if (err?.message?.includes('stole it') || err?.message?.includes('Lock')) {
        console.warn('[LOCK_BYPASS] Supabase lock stolen (fetchStaff). Returning [].');
        return [];
      }
      console.error('Fetch staff error:', err);
      return [];
    }
  },
  async upsertStaff(staff: any[]) {
    const validKeys = [
      'id', 'name', 'placement', 'role', 'status', 'jobType', 'permissions', 
      'noHoliday', 'phone', 'password', 'createdAt', 'isApproved', 'pin',
      'isLocked', 'lockedMonths'
    ];
    const filtered = staff.map(s => {
      const obj: any = {};
      validKeys.forEach(k => { if (s[k] !== undefined) obj[k] = s[k]; });
      if (s.user_id) obj.user_id = s.user_id; // Add user_id if present
      return mapToSql(obj, STAFF_MAP);
    });
    const { error } = await supabase.from('staff').upsert(filtered, { onConflict: 'id' });
    if (error) {
      console.error('❌ Staff sync error:', error);
      let msg = `Staff save failed: ${error.message} (${error.code})`;
      if (error.code === '42501') msg = '職員情報の更新権限がありません(RLS制約)。管理者の認証を確認してください。';
      if (typeof window !== 'undefined') {
        console.warn('%c[SECURITY ERROR]', 'color: red; font-weight: bold;', msg);
      }
      throw new Error(msg);
    }
    console.log('✅ Staff synced to cloud successfully');
  },
  async upsertSingleStaff(s: any) {
    const validKeys = ['id', 'name', 'email', 'placement', 'role', 'jobType', 'status', 'noHoliday', 'isApproved', 'permissions', 'password', 'isLocked', 'lockedMonths'];
    const obj: any = {};
    validKeys.forEach(k => { if (s[k] !== undefined) obj[k] = s[k]; });
    
    try {
      const { error } = await supabase.from('staff').upsert(mapToSql(obj, STAFF_MAP), { onConflict: 'id' });
      if (error) {
        console.error('SUPABASE INSERT ERROR (upsertSingleStaff):', error);
        throw error;
      }
    } catch (err: any) {
      console.error('CRITICAL: cloudStorage.upsertSingleStaff failed:', err);
      throw err;
    }
  },

  // --- Requests ---
  async fetchRequests() {
    try {
      if (!supabase) return [];
      // 取得上限を大幅に引き上げ
      // status が deleted のものは取得しない（ゾンビデータ復活防止）
      const { data, error } = await supabase
        .from('requests')
        .select('*')
        .neq('status', 'deleted')
        .limit(100000);
      if (error) {
        console.warn('[CONFIG_ERROR Handled] fetchRequests failed:', error.message);
        return [];
      }
      return (data || []).map(r => {
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
    } catch (err: any) {
      if (err?.message?.includes('stole it') || err?.message?.includes('Lock')) {
        console.warn('[LOCK_BYPASS] Supabase lock stolen (fetchRequests). Returning [].');
        return [];
      }
      console.warn('[CRITICAL CATCH] fetchRequests failed:', err);
      return [];
    }
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
      
      // クライアント側がタイムスタンプを持っていないのに、クラウド側が持っている場合は上書き禁止
      if (clientTime === 0 && cloudTime > 0) return false;
      
      // クライアント側がクラウドより新しい（または等しい）場合のみ上書きを許可
      return clientTime >= cloudTime;
    }).map(r => {
      const obj: any = {};
      const validKeys = ['id', 'staffName', 'staffId', 'userId', 'staff_id', 'user_id', 'date', 'type', 'status', 'details', 'reason', 'createdAt'];
      
      const details = { ...(r.details || {}) };
      if (r.updatedAt) details.updatedAt = r.updatedAt;
      if (r.source) details.source = r.source;
      if (r.isManual !== undefined) details.isManual = r.isManual;
      if (r.priority !== undefined) details.priority = r.priority;
      if (r.hours !== undefined) details.hours = r.hours;
      if (r.locked !== undefined) details.locked = r.locked;
      
      const payload = { 
        ...r, 
        staffName: normalizeName(r.staffName || ''),
        details 
      };
      validKeys.forEach(k => { if (payload[k] !== undefined) obj[k] = payload[k]; });
      return mapToSql(obj, REQ_MAP);
    });

    if (filtered.length === 0) {
      console.log('No newer requests to sync. Skipping upsert.');
      return;
    }

    const { error } = await supabase.from('requests').upsert(filtered, { onConflict: 'id' });
    if (error) {
       console.error('❌ Requests sync error:', error);
       let msg = `Save failed: ${error.message} (${error.code})`;
       if (error.code === '42501') msg = '申請の更新権限がないか、他人の申請を操作しようとしました(RLS制約)。';
       throw new Error(msg);
    }
    console.log(`✅ ${filtered.length} requests synced to cloud successfully (Safe-Upsert)`);
  },
  async upsertShifts(shifts: any[]) {
    if (!shifts || shifts.length === 0) return;
    const filtered = shifts.map(s => {
      const obj: any = {};
      // [V75.2] shiftsテーブルには updated_at カラムがないため除外する
      const validKeys = ['id', 'staff_id', 'staff_name', 'date', 'type', 'status', 'is_manual', 'details', 'created_at'];
      validKeys.forEach(k => { if (s[k] !== undefined) obj[k] = s[k]; });
      if (obj.staff_name) obj.staff_name = normalizeName(obj.staff_name);
      return obj;
    });
    const { error } = await supabase.from('shifts').upsert(filtered, { onConflict: 'id' });
    if (error) {
      console.error('❌ Shifts sync error:', error);
      throw error;
    }
    console.log(`✅ ${filtered.length} shifts synced to cloud successfully`);
  },
  async fetchShifts() {
    try {
      const { data, error } = await supabase.from('shifts').select('*').limit(100000);
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Fetch shifts error:', err);
      return [];
    }
  },
  /**
   * [CRITICAL V73.0] requests と shifts の両方をアトミックに（疑似的に）更新し不整合を防止
   */
  async upsertRequestsAndShifts(requests: any[]) {
    if (!requests || requests.length === 0) return;
    
    // 1. requests への保存
    await this.upsertRequests(requests);
    
    // 2. shifts へのマッピングと保存
    const shiftPayloads = requests.map(r => ({
      id: r.id,
      staff_id: r.staff_id || r.staffId || r.userId || r.user_id,
      staff_name: r.staff_name || r.staffName,
      date: r.date,
      type: r.type,
      status: r.status,
      is_manual: !!(r.isManual || r.is_manual || String(r.id).startsWith('m-') || String(r.id).startsWith('req-')),
      details: r.details,
      updated_at: r.updatedAt || r.updated_at || new Date().toISOString()
    }));
    
    await this.upsertShifts(shiftPayloads);
  },
  async upsertSingleRequest(r: any) {
    // 安全のため、単一更新も共通の Safe-Upsert ロジックを通す
    await this.upsertRequests([r]);
  },
   async deleteRequest(id: string) {
    // requests テーブルから削除
    const { error: err1 } = await supabase.from('requests').delete().eq('id', id);
    if (err1) {
      console.error('Request deletion error:', err1);
      throw err1;
    }
    // shifts テーブルからも削除（V73.0 整合性確保）
    const { error: err2 } = await supabase.from('shifts').delete().eq('id', id);
    if (err2) {
      console.error('Shift deletion error:', err2);
    }
    console.log(`✅ Record ${id} deleted from both tables.`);
  },
  async deleteRequests(ids: string[]) {
    if (!ids || ids.length === 0) return;
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      // requests から削除
      const { error: err1 } = await supabase.from('requests').delete().in('id', chunk);
      if (err1) throw err1;
      // shifts から削除
      const { error: err2 } = await supabase.from('shifts').delete().in('id', chunk);
      if (err2) console.error('Bulk shift deletion error:', err2);
    }
    console.log(`✅ ${ids.length} records deleted from both tables.`);
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
    const { cleanList } = deduplicateRequests([...(cloudReqs || []), ...(requests || [])]);
    
    // 3. 【新設ガード】マージ後のデータがクラウド側の既存データより著しく少ない場合は警告して中断
    // これにより、不完全なデータによる「先祖返り」や「全消去」を物理的に阻止します。
    if (cloudReqs.length > 0 && cleanList.length === 0) {
      console.warn('Smart-Sync protection: Blocked empty overwrite. Cloud had data but merged result was empty.');
      return;
    }

    // 4. マージ後の結果を Safe-Upsert で保存
    await this.upsertRequests(cleanList);
    console.log(`Smart-Sync completed. Resulting in ${cleanList.length} unified requests.`);
  },

  // --- Realtime (V74.6 Bulletproof) ---
  subscribeToChanges(callback: (payload: any) => void) {
    console.log('--- [REALTIME] Initializing Subscription (shifts, requests) ---');
    const channel = supabase
      .channel('db-changes-v74')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, (payload) => {
        console.log('--- [REALTIME_DEBUG] Request Event:', payload.eventType, 'ID:', payload.new?.id || payload.old?.id);
        callback(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, (payload) => {
        console.log('--- [REALTIME_DEBUG] Shift Event:', payload.eventType, 'ID:', payload.new?.id || payload.old?.id);
        callback(payload);
      })
      .subscribe((status, err) => {
        console.log(`--- [REALTIME_STATUS] Status: ${status} ---`);
        if (err) console.error('--- [REALTIME_ERROR] Connection failed:', err);
        if (status === 'SUBSCRIBED') {
          console.log('--- [REALTIME_READY] Listening for changes in public.shifts and public.requests ---');
        }
      });
    return channel;
  },
  async unsubscribe(channel: any) {
    if (channel) {
      console.log('--- [REALTIME] Removing channel subscription ---');
      await supabase.removeChannel(channel);
    }
  },

  // --- Config ---
  async fetchConfigs() {
    try {
      const { data, error } = await supabase.from('app_config').select('*');
      if (error) throw error;
      const configMap: Record<string, any> = {};
      (data || []).forEach(row => {
        configMap[row.key] = row.value;
      });
      return configMap;
    } catch (err) {
      console.error('Fetch configs error:', err);
      return {};
    }
  },
  async upsertConfig(key: string, value: any) {
    try {
      const { error } = await supabase
        .from('app_config')
        .upsert({ key, value }, { onConflict: 'key' });
      if (error) throw error;
      console.log(`✅ Config [${key}] synced to cloud`);
    } catch (err) {
      console.error(`Upsert config [${key}] error:`, err);
      throw err;
    }
  }
};
