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
 * 渡されたID文字列から正規のUUID (8-4-4-4-12形式) を抽出・サニタイズする
 * - "fallback-c840b456-4a14-4756-9ee4-4e3ec2972301" -> "c840b456-4a14-4756-9ee4-4e3ec2972301"
 * - "req-c840b456-4a14-4756-9ee4-4e3ec2972301" -> "c840b456-4a14-4756-9ee4-4e3ec2972301"
 * - 不正値や非UUID文字列 -> null (Postgresの invalid input syntax for type uuid を完全防止)
 */
export const sanitizeUuid = (val?: string | null): string | null => {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = trimmed.match(uuidRegex);
  return match ? match[0].toLowerCase() : null;
};

/**
 * 操作ログ（監査ログ）を Supabase の audit_logs テーブルへ書き込む共通関数
 */
export const recordAuditLog = async (params: AuditLogParams): Promise<boolean> => {
  try {
    const operatorId = sanitizeUuid(params.operatorId);
    const targetStaffId = sanitizeUuid(params.targetStaffId);

    const payload = {
      operator_id: operatorId,
      operator_name: params.operatorName || 'システム',
      target_staff_id: targetStaffId,
      target_staff_name: params.targetStaffName || '',
      action_type: params.actionType,
      target_date: params.targetDate || null,
      details: params.details || '',
      before_data: params.beforeData || null,
      after_data: params.afterData || null,
      created_at: new Date().toISOString(),
    };

    console.log('[AuditLog] Inserting into audit_logs:', payload.action_type, payload.details, payload);

    const { data, error } = await supabase.from('audit_logs').insert([payload]).select();
    if (error) {
      console.error('❌ [AuditLog] Supabase INSERT error:', error.message, error.details, error);
      return false;
    }
    console.log('✅ [AuditLog] Successfully recorded audit log:', data);
    return true;
  } catch (error) {
    console.error('❌ [AuditLog] Fatal error recording audit log:', error);
    return false;
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
