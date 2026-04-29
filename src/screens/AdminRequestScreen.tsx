import React, { useState, useMemo } from 'react';
import { StyleSheet, View, SafeAreaView, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { ClipboardList, CheckCircle2, AlertCircle, Clock, Calendar, User, Search, Filter, ChevronLeft } from 'lucide-react-native';
import { formatDate } from '../utils/dateUtils';
import { supabase } from '../utils/supabase';

interface AdminRequestScreenProps {
  requests: any[];
  approveRequest: (id: string, status: string) => void;
  handleBulkApprove: (ids: string[]) => Promise<void>;
  deleteRequest: (id: string) => void;
  handleReject: (id: string) => Promise<void>;
  onBack: () => void;
}

export const AdminRequestScreen: React.FC<AdminRequestScreenProps> = ({ 
  requests, approveRequest, handleBulkApprove, deleteRequest, handleReject, onBack 
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved'>('pending');
  
  const filteredRequests = useMemo(() => {
    let list = requests.filter(r => r && r.type !== '出勤' && r.type !== '公休' && r.status !== 'deleted' && r.status !== 'rejected');
    if (filter !== 'all') {
      list = list.filter(r => r.status === filter);
    }
    // Sort by date (newest first), then by updated time
    return [...list].sort((a, b) => {
      const dateA = a.date ? new Date(String(a.date).replace(/-/g, '/')).getTime() : 0;
      const dateB = b.date ? new Date(String(b.date).replace(/-/g, '　/')).getTime() : 0;
      
      if (dateB !== dateA) return dateB - dateA;
      
      const timeA = new Date(a.updatedAt || a.createdAt || a.created_at || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || b.created_at || 0).getTime();
      return timeB - timeA;
    });
  }, [requests, filter]);

  const handleApproveAll = async () => {
    const pendings = filteredRequests.filter(r => r.status === 'pending');
    if (pendings.length === 0) return;

    if (Platform.OS === 'web') {
      const confirmOk = window.confirm(`表示中の承認待ち申請 ${pendings.length} 件をすべて承認しますか？`);
      if (!confirmOk) return;
      window.alert("一括承認の処理を開始します...");
    } else {
      Alert.alert('一括承認処理を開始します...');
    }

    try {
      const ids = pendings.map(r => r.id);
      const { error } = await supabase.from('requests').update({ status: 'approved' }).in('id', ids);
      
      if (error) throw error;

      if (Platform.OS === 'web') {
        window.alert("一括承認が完了しました！");
        window.location.reload();
      } else {
        Alert.alert('完了', '一括承認しました');
      }
    } catch (err: any) {
      if (Platform.OS === 'web') window.alert("エラーが発生しました: " + err.message);
      else Alert.alert("エラー", err.message);
    }
  };

  const handleHardwiredApprove = async (id: string) => {
    if (Platform.OS === 'web') window.alert("承認処理を開始します...");
    else Alert.alert('承認処理を開始します...');

    try {
      const { error } = await supabase.from('requests').update({ status: 'approved' }).eq('id', id);
      if (error) throw error;

      if (Platform.OS === 'web') {
        window.alert("承認が完了しました！");
        window.location.reload();
      } else {
        Alert.alert('完了', '承認しました');
      }
    } catch (err: any) {
      if (Platform.OS === 'web') window.alert("エラーが発生しました: " + err.message);
      else Alert.alert("エラー", err.message);
    }
  };

  const handleHardwiredReject = async (id: string) => {
    if (Platform.OS === 'web') {
      const confirmOk = window.confirm("この申請を却下しますか？");
      if (!confirmOk) return;
      window.alert("却下処理を開始します...");
    } else {
      Alert.alert('却下処理を開始します...');
    }

    try {
      const { error } = await supabase.from('requests').update({ status: 'rejected' }).eq('id', id);
      if (error) throw error;

      if (Platform.OS === 'web') {
        window.alert("却下・取り消しが完了しました！");
        window.location.reload();
      } else {
        Alert.alert('完了', '却下・取り消ししました');
      }
    } catch (err: any) {
      if (Platform.OS === 'web') window.alert("エラーが発生しました: " + err.message);
      else Alert.alert("エラー", err.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <ChevronLeft color={COLORS.text} size={24} />
        </TouchableOpacity>
        <View>
          <ThemeText variant="h1">申請承認ダッシュボード</ThemeText>
          <ThemeText variant="caption">全職員からの申請・届出の管理</ThemeText>
        </View>
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          <TouchableOpacity 
            style={[styles.filterChip, filter === 'pending' && styles.filterChipActive]} 
            onPress={() => setFilter('pending')}
          >
            <ThemeText variant="caption" color={filter === 'pending' ? COLORS.background : COLORS.text}>承認待ち</ThemeText>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.filterChip, filter === 'approved' && styles.filterChipActive]} 
            onPress={() => setFilter('approved')}
          >
            <ThemeText variant="caption" color={filter === 'approved' ? COLORS.background : COLORS.text}>承認済み</ThemeText>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.filterChip, filter === 'all' && styles.filterChipActive]} 
            onPress={() => setFilter('all')}
          >
            <ThemeText variant="caption" color={filter === 'all' ? COLORS.background : COLORS.text}>すべて</ThemeText>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {filter === 'pending' && filteredRequests.length > 0 && (
        <TouchableOpacity style={styles.batchBtn} onPress={handleApproveAll}>
          <CheckCircle2 size={16} color="white" />
          <ThemeText style={styles.batchBtnText}>表示中の待機分を一括承認</ThemeText>
        </TouchableOpacity>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {filteredRequests.length === 0 ? (
          <View style={styles.emptyState}>
            <ClipboardList size={48} color="rgba(255,255,255,0.05)" />
            <ThemeText color={COLORS.textSecondary} style={{ marginTop: 16 }}>
              該当する申請はありません
            </ThemeText>
          </View>
        ) : (
          filteredRequests.map(item => (
            <ThemeCard key={item.id} style={styles.requestCard}>
              <View style={styles.cardHeader}>
                <View style={styles.userInfo}>
                  <View style={styles.avatar}>
                    <ThemeText bold color={COLORS.primary}>{item.staffName?.[0] || '?'}</ThemeText>
                  </View>
                  <View>
                    <ThemeText bold>{item.staffName}</ThemeText>
                    <ThemeText variant="caption" color={COLORS.textSecondary}>{formatDate(item.date)}</ThemeText>
                  </View>
                </View>
                <View style={[
                  styles.statusBadge, 
                  { backgroundColor: item.status === 'approved' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(234, 179, 8, 0.1)' }
                ]}>
                  {item.status === 'approved' ? (
                    <CheckCircle2 size={14} color="#22c55e" />
                  ) : (
                    <AlertCircle size={14} color="#eab308" />
                  )}
                  <ThemeText 
                    variant="caption" 
                    style={{ color: item.status === 'approved' ? '#22c55e' : '#eab308', marginLeft: 4 }}
                  >
                    {item.status === 'approved' ? '承認済み' : '承認待ち'}
                  </ThemeText>
                </View>
              </View>

              <View style={styles.cardBody}>
                <View style={styles.typeRow}>
                  <View style={[styles.typeBadge, { backgroundColor: item.type === '時間外出勤' ? 'rgba(249, 115, 22, 0.1)' : 'rgba(56, 189, 248, 0.1)' }]}>
                    <ThemeText variant="caption" bold color={item.type === '時間外出勤' ? '#f97316' : '#38bdf8'}>{item.type}</ThemeText>
                  </View>
                  {item.details?.duration && (
                    <ThemeText variant="caption" bold style={{ color: COLORS.accent, marginLeft: 8 }}>{item.details.duration}時間</ThemeText>
                  )}
                </View>
                <ThemeText variant="body" style={styles.reasonText}>
                  {item.reason || '（詳細なし）'}
                </ThemeText>
                {item.details?.startTime && (
                  <ThemeText variant="caption" color={COLORS.textSecondary}>
                    時間: {item.details.startTime} 〜 {item.details.endTime}
                  </ThemeText>
                )}
              </View>

              <View style={styles.cardActions}>
                {item.status === 'pending' ? (
                  <>
                    <TouchableOpacity 
                      style={[styles.actionBtn, styles.approveBtn]} 
                      onPress={() => handleHardwiredApprove(item.id)}
                    >
                      <CheckCircle2 size={16} color="white" />
                      <ThemeText variant="caption" color="white" bold style={{ marginLeft: 4 }}>承認</ThemeText>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.actionBtn, styles.rejectBtn]} 
                      onPress={() => handleHardwiredReject(item.id)}
                    >
                      <ThemeText variant="caption" color={COLORS.danger}>却下</ThemeText>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity 
                    style={[styles.actionBtn, styles.undoBtn]} 
                    onPress={() => approveRequest(item.id, 'pending')}
                  >
                    <ThemeText variant="caption" color={COLORS.textSecondary}>承認を戻す</ThemeText>
                  </TouchableOpacity>
                )}
              </View>
            </ThemeCard>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: COLORS.background,
    width: '100%',
    maxWidth: '100%',
    alignItems: 'stretch',
    alignSelf: 'stretch'
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: SPACING.md, 
    marginTop: SPACING.md,
    width: '100%',
    alignSelf: 'stretch'
  },
  backBtn: { marginRight: 16 },
  filterBar: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingVertical: 8 },
  filterScroll: { paddingHorizontal: SPACING.md, gap: 8 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  batchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#10b981', marginHorizontal: SPACING.md, marginTop: 12, paddingVertical: 10, borderRadius: 8, gap: 8 },
  batchBtnText: { color: 'white', fontWeight: 'bold', fontSize: 13 },
  scrollContent: { 
    padding: SPACING.md, 
    paddingBottom: 100,
    width: '100%',
    alignItems: 'stretch'
  },
  requestCard: { 
    marginBottom: SPACING.md, 
    padding: SPACING.md,
    width: '100%',
    alignSelf: 'stretch'
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  userInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(56, 189, 248, 0.1)', justifyContent: 'center', alignItems: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.full },
  cardBody: { backgroundColor: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 8, gap: 6 },
  typeRow: { flexDirection: 'row', alignItems: 'center' },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  reasonText: { fontSize: 13, color: COLORS.text },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  approveBtn: { backgroundColor: '#22c55e' },
  rejectBtn: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)' },
  undoBtn: { backgroundColor: 'rgba(255,255,255,0.05)' },
  emptyState: { padding: 80, alignItems: 'center', justifyContent: 'center' },
});
