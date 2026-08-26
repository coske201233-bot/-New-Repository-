import { supabase } from './supabase';

export interface AuditLogParams {
  operatorId?: string;
  operatorName?: string;
  targetStaffId?: string;
  targetStaffName?: string;
  actionType: 'SHIFT_UPDATE' | 'REQUEST_CREATE' | 'REQUEST_APPROVE' | 'REQUEST_REJECT' | 'REQUEST_DELETE';
  targetDate?: string;
  details: string;
  beforeData?: any;
  afterData?: any;
}

export interface AuditLogRecord {
  id: number | string;
  operator_id: string | null;
  operator_name: string;
  target_staff_id: string | null;
  target_staff_name: string;
  action_type: 'SHIFT_UPDATE' | 'REQUEST_CREATE' | 'REQUEST_APPROVE' | 'REQUEST_REJECT' | 'REQUEST_DELETE';
  target_date: string | null;
  details: string;
  before_data: any | null;
  after_data: any | null;
  created_at: string;
}

/**
 * 操作ログ（監査ログ）を Supabase の audit_logs テーブルへ非同期で書き込む共通関数
 */
export const recordAuditLog = async (params: AuditLogParams): Promise<void> => {
  try {
    const payload = {
      operator_id: params.operatorId || null,
      operator_name: params.operatorName || 'システム',
      target_staff_id: params.targetStaffId || null,
      target_staff_name: params.targetStaffName || '',
      action_type: params.actionType,
      target_date: params.targetDate || null,
      details: params.details,
      before_data: params.beforeData || null,
      after_data: params.afterData || null,
      created_at: new Date().toISOString(),
    };

    console.log('[AuditLog] Recording:', payload.action_type, payload.details);

    const { error } = await supabase.from('audit_logs').insert([payload]);
    if (error) {
      console.warn('[AuditLog] Supabase insert warning:', error.message);
    }
  } catch (error) {
    console.warn('[AuditLog] Failed to record:', error);
  }
};

/**
 * 監査ログ一覧を取得する関数（管理者向け）
 */
export const fetchAuditLogs = async (limit: number = 200): Promise<AuditLogRecord[]> => {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[AuditLog] fetchAuditLogs error:', error.message);
      return [];
    }
    return (data as AuditLogRecord[]) || [];
  } catch (error) {
    console.warn('[AuditLog] Failed to fetch audit logs:', error);
    return [];
  }
};
