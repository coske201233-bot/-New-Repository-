import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  SafeAreaView,
  Platform,
} from 'react-native';
import { ThemeText } from './ThemeText';
import { ThemeCard } from './ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import {
  X,
  RefreshCw,
  Search,
  Filter,
  History,
  CheckCircle2,
  XCircle,
  Trash2,
  Calendar,
  User,
  Clock,
  ChevronDown,
  ChevronUp,
  ArrowRightLeft,
  UserCheck,
} from 'lucide-react-native';
import { fetchAuditLogs, AuditLogRecord, AuditActionType } from '../utils/auditLogger';

interface AuditLogModalProps {
  visible: boolean;
  onClose: () => void;
}

export const AuditLogModal: React.FC<AuditLogModalProps> = ({ visible, onClose }) => {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<number | string | null>(null);

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchAuditLogs(300);
      setLogs(data);
    } catch (e) {
      console.error('[AuditLogModal] Load error:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadLogs();
    }
  }, [visible, loadLogs]);

  const normalizeStr = (str?: string | null) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/[\s\u3000]/g, '')
      .normalize('NFKC');
  };

  const getActionBadge = (actionType: string) => {
    switch (actionType) {
      case 'SHIFT_UPDATE':
        return { label: 'シフト変更', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)', icon: Calendar };
      case 'SHIFT_MOVE':
        return { label: '日付移動', color: '#22d3ee', bg: 'rgba(34, 211, 238, 0.15)', icon: ArrowRightLeft };
      case 'SHIFT_DELETE':
        return { label: 'シフト削除', color: '#f87171', bg: 'rgba(248, 113, 113, 0.15)', icon: Trash2 };
      case 'REQUEST_CREATE':
        return { label: '申請提出', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', icon: Clock };
      case 'REQUEST_APPROVE':
        return { label: '申請承認', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)', icon: CheckCircle2 };
      case 'REQUEST_REJECT':
        return { label: '申請却下', color: '#fb7185', bg: 'rgba(251, 113, 133, 0.15)', icon: XCircle };
      case 'REQUEST_DELETE':
        return { label: '申請削除', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.15)', icon: Trash2 };
      case 'STAFF_UPDATE':
        return { label: '職員情報変更', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)', icon: UserCheck };
      default:
        return { label: actionType || '操作履歴', color: COLORS.textSecondary, bg: 'rgba(255, 255, 255, 0.1)', icon: History };
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // 1. タイプフィルター（自然な操作順グループ）
      if (filterType !== 'ALL') {
        if (filterType === 'REQUEST_GROUP') {
          if (!['REQUEST_CREATE', 'REQUEST_APPROVE', 'REQUEST_REJECT', 'REQUEST_DELETE'].includes(log.action_type)) {
            return false;
          }
        } else if (filterType === 'DELETE_GROUP') {
          if (!['SHIFT_DELETE', 'REQUEST_DELETE'].includes(log.action_type)) {
            return false;
          }
        } else if (log.action_type !== filterType) {
          return false;
        }
      }
      // 2. 検索クエリ (正規化照合)
      if (searchQuery.trim()) {
        const query = normalizeStr(searchQuery);
        const opName = normalizeStr(log.operator_name);
        const targetName = normalizeStr(log.target_staff_name);
        const details = normalizeStr(log.details);
        const targetDate = normalizeStr(log.target_date);
        const type = normalizeStr(log.action_type);
        const badgeLabel = normalizeStr(getActionBadge(log.action_type).label);

        if (
          !opName.includes(query) &&
          !targetName.includes(query) &&
          !details.includes(query) &&
          !targetDate.includes(query) &&
          !type.includes(query) &&
          !badgeLabel.includes(query)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [logs, filterType, searchQuery]);

  const formatTimestamp = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const sec = String(d.getSeconds()).padStart(2, '0');
      return `${y}/${m}/${day} ${h}:${min}:${sec}`;
    } catch {
      return dateStr;
    }
  };

  const filterOptions = [
    { key: 'ALL', label: 'すべて' },
    { key: 'SHIFT_UPDATE', label: 'シフト変更' },
    { key: 'SHIFT_MOVE', label: '日付移動' },
    { key: 'REQUEST_GROUP', label: '申請関連' },
    { key: 'DELETE_GROUP', label: '削除' },
    { key: 'STAFF_UPDATE', label: '職員変更' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <SafeAreaView style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.titleIcon}>
                <History size={22} color="#a855f7" />
              </View>
              <ThemeText variant="h1" style={styles.headerTitle}>
                操作履歴（監査ログ）
              </ThemeText>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={loadLogs}
                disabled={isLoading}
                activeOpacity={0.7}
              >
                <RefreshCw size={20} color={isLoading ? COLORS.textSecondary : '#38bdf8'} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={onClose} activeOpacity={0.7}>
                <X size={24} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <Search size={18} color={COLORS.textSecondary} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="スタッフ名、操作者、詳細で検索..."
              placeholderTextColor={COLORS.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
                <X size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Filter Chips */}
          <View style={styles.filterBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              {filterOptions.map((opt) => {
                const isActive = filterType === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.filterChip, isActive && styles.filterChipActive]}
                    onPress={() => setFilterType(opt.key)}
                    activeOpacity={0.7}
                  >
                    <ThemeText
                      variant="caption"
                      bold={isActive}
                      color={isActive ? '#0f172a' : COLORS.textSecondary}
                    >
                      {opt.label}
                    </ThemeText>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Log List */}
          {isLoading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#a855f7" />
              <ThemeText style={{ marginTop: 12 }} color={COLORS.textSecondary}>
                操作履歴を取得中...
              </ThemeText>
            </View>
          ) : filteredLogs.length === 0 ? (
            <View style={styles.centerContainer}>
              <History size={48} color={COLORS.textSecondary} style={{ opacity: 0.3, marginBottom: 12 }} />
              <ThemeText bold color={COLORS.textSecondary}>
                履歴が見つかりませんでした
              </ThemeText>
              <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginTop: 4 }}>
                {searchQuery ? '検索条件を変更してください' : '操作が行われるとここに自動記録されます'}
              </ThemeText>
            </View>
          ) : (
            <ScrollView style={styles.listContainer} contentContainerStyle={{ paddingBottom: 30 }}>
              <ThemeText variant="caption" color={COLORS.textSecondary} style={styles.countText}>
                {filteredLogs.length} 件の操作履歴を表示中
              </ThemeText>
              {filteredLogs.map((log) => {
                const badge = getActionBadge(log.action_type);
                const BadgeIcon = badge.icon;
                const isExpanded = expandedLogId === log.id;
                const hasExtraData = log.before_data || log.after_data;

                return (
                  <ThemeCard key={log.id} style={styles.logCard}>
                    {/* Card Header: Type Badge, Target Date & Timestamp */}
                    <View style={styles.cardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <View style={[styles.badge, { backgroundColor: badge.bg, borderColor: badge.color + '40', borderWidth: 1 }]}>
                          <BadgeIcon size={12} color={badge.color} style={{ marginRight: 4 }} />
                          <ThemeText bold style={{ fontSize: 11, color: badge.color }}>
                            {badge.label}
                          </ThemeText>
                        </View>

                        {log.target_date ? (
                          <View style={styles.dateTag}>
                            <Calendar size={11} color="#94a3b8" style={{ marginRight: 3 }} />
                            <ThemeText style={{ fontSize: 11, color: '#cbd5e1' }}>
                              {log.target_date}
                            </ThemeText>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.timeRow}>
                        <Clock size={11} color={COLORS.textSecondary} style={{ marginRight: 4 }} />
                        <ThemeText variant="caption" color={COLORS.textSecondary} style={{ fontSize: 11 }}>
                          {formatTimestamp(log.created_at)}
                        </ThemeText>
                      </View>
                    </View>

                    {/* Details Main Text */}
                    <View style={styles.detailsContainer}>
                      <ThemeText bold style={styles.detailsText}>
                        {log.details}
                      </ThemeText>
                    </View>

                    {/* Meta info tags */}
                    <View style={styles.metaRow}>
                      <View style={styles.metaItem}>
                        <User size={12} color={COLORS.textSecondary} style={{ marginRight: 4 }} />
                        <ThemeText variant="caption" color={COLORS.textSecondary}>
                          操作者: <ThemeText variant="caption" bold color="#e2e8f0">{log.operator_name || 'システム'}</ThemeText>
                        </ThemeText>
                      </View>

                      {log.target_staff_name ? (
                        <View style={styles.metaItem}>
                          <ThemeText variant="caption" color={COLORS.textSecondary}>
                            対象スタッフ: <ThemeText variant="caption" bold color="#38bdf8">{log.target_staff_name}</ThemeText>
                          </ThemeText>
                        </View>
                      ) : null}
                    </View>

                    {/* Expandable JSON Data */}
                    {hasExtraData && (
                      <View style={styles.expandSection}>
                        <TouchableOpacity
                          style={styles.expandBtn}
                          onPress={() => setExpandedLogId(isExpanded ? null : log.id)}
                          activeOpacity={0.7}
                        >
                          <ThemeText variant="caption" color="#38bdf8" style={{ fontSize: 11 }}>
                            {isExpanded ? '変更データを閉じる' : '詳細データを確認'}
                          </ThemeText>
                          {isExpanded ? (
                            <ChevronUp size={14} color="#38bdf8" />
                          ) : (
                            <ChevronDown size={14} color="#38bdf8" />
                          )}
                        </TouchableOpacity>

                        {isExpanded && (
                          <View style={styles.jsonBox}>
                            {log.before_data && (
                              <View style={{ marginBottom: 8 }}>
                                <ThemeText variant="caption" bold color="#ef4444" style={{ marginBottom: 2 }}>
                                  【変更前データ】
                                </ThemeText>
                                <ThemeText style={styles.jsonText}>
                                  {JSON.stringify(log.before_data, null, 2)}
                                </ThemeText>
                              </View>
                            )}
                            {log.after_data && (
                              <View>
                                <ThemeText variant="caption" bold color="#10b981" style={{ marginBottom: 2 }}>
                                  【変更後データ】
                                </ThemeText>
                                <ThemeText style={styles.jsonText}>
                                  {JSON.stringify(log.after_data, null, 2)}
                                </ThemeText>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    )}
                  </ThemeCard>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
    backgroundColor: '#0f172a',
    borderRadius: Platform.OS === 'web' ? 16 : 0,
    marginVertical: Platform.OS === 'web' ? 24 : 0,
    overflow: 'hidden',
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#1e293b',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    height: 42,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 14,
    height: '100%',
    padding: 0,
  },
  filterBar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  filterScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  filterChipActive: {
    backgroundColor: '#38bdf8',
    borderColor: '#38bdf8',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  listContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  countText: {
    marginBottom: 8,
    fontSize: 12,
  },
  logCard: {
    padding: 14,
    marginBottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  detailsContainer: {
    marginVertical: 6,
  },
  detailsText: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#f8fafc',
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  expandSection: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  jsonBox: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#020617',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  jsonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#cbd5e1',
    lineHeight: 16,
  },
});
