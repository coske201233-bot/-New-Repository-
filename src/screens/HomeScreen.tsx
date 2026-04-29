import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, SafeAreaView, TouchableOpacity, Modal, Platform, ActivityIndicator } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { Users, Coffee, Briefcase, Building2, MapPin, X, RefreshCw, AlertCircle, ChevronRight, LogOut, Calendar as CalendarIcon } from 'lucide-react-native';
import { getDayType, getDateStr } from '../utils/dateUtils';
import { sortStaffByName } from '../utils/staffUtils';
import { getCurrentLimit } from '../utils/limitUtils';

const hospitalPlacements = ['２F', '４F', '訪問リハ', 'フォロー', '兼務', '管理', '外来', '助手'];

interface HomeScreenProps {
  onNavigateToStaff?: (ward: string) => void;
  staffList: any[];
  requests: any[];
  saturdayLimit: number;
  sundayLimit: number;
  publicHolidayLimit: number;
  monthlyLimits: Record<string, { weekday: number, sat: number, sun: number, pub: number }>;
  staffViewMode?: boolean;
  onForceCloudSync?: () => Promise<boolean>;
  profile?: any;
  isAdminAuthenticated?: boolean;
  onOpenRequests?: () => void;
  onLogout?: () => void;
  isInitialized?: boolean;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ 
  onNavigateToStaff, staffList, requests, weekdayLimit,
  saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, staffViewMode = false,
  onForceCloudSync, profile, isAdminAuthenticated, onOpenRequests, onLogout,
  isInitialized
}) => {
  const [selectedWardDetails, setSelectedWardDetails] = useState<string | null>(null);

  // シニアアーキテクト指令: 厳格な配列検証と防弾レンダリング (VERSION 43.0)
  const safeStaff = Array.isArray(staffList) ? staffList : [];
  
  // [CRITICAL VERSION 48.20] ANNIHILATED OVERLAY
  // The global spinner block has been completely disabled.
  // The component MUST return actual content immediately.
  /*
  const isMasterAdmin = isAdminAuthenticated || profile?.email === 'admin@reha.local';
  if ((!isInitialized || !Array.isArray(staffList)) && !isMasterAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <ThemeText variant="h2" style={{ marginTop: 20 }}>同期完了を待機中...</ThemeText>
        <ThemeText variant="caption" style={{ marginTop: 10, color: COLORS.textSecondary }}>データ初期化中</ThemeText>
      </SafeAreaView>
    );
  }
  */
  
  try {
    // ---------------------------------------------------------
    // 1. 正規化データアクセスヘルパー (日英両対応)
    // ---------------------------------------------------------
    const getStaffData = (s: any) => {
      if (!s) return { job: '', role: '', placement: '', status: '通常' };
      return {
        job: s?.職種 || s?.jobType || s?.profession || s?.job_type || '',
        role: s?.役割 || s?.role || s?.position || '',
        placement: s?.配置 || s?.placement || '',
        status: s?.ステータス || s?.status || '通常',
      };
    };

    const isExcluded = (s: any) => {
      const data = getStaffData(s);
      // 訪問リハ、包括、排尿、長期休暇/入職前、そして助手は通常のPT/OT/ST集計から除外（優先して別カウント）
      const isVisit = data.role === '訪問リハ' || data.placement === '訪問' || data.placement === '訪問リハ';
      const isHokatsu = data.role === '包括' || data.placement === '包括' || data.job === '包括';
      const isHainyo = data.role === '排尿' || data.role === '排尿支援' || data.placement === '排尿' || data.placement === '排尿支援';
      const isInactive = data.status === '長期休暇' || data.status === '入職前';
      const isAssistant = data.job === '助手' || data.role === '助手' || data.placement === '助手';
      return isVisit || isHokatsu || isHainyo || isInactive || isAssistant;
    };

    // ---------------------------------------------------------
    // 2. 統計情報の計算 (React.useMemoで最適化)
    // ---------------------------------------------------------
    const stats = React.useMemo(() => {
      // isApprovedがデフォルトfalseの場合があるため、ダッシュボードの集計にはすべてsafeStaffを使用
      
      const ptCount = safeStaff.filter(s => {
        const data = getStaffData(s);
        return data.job === 'PT' && !isExcluded(s);
      }).length;

      const otCount = safeStaff.filter(s => {
        const data = getStaffData(s);
        return data.job === 'OT' && !isExcluded(s);
      }).length;

      const stCount = safeStaff.filter(s => {
        const data = getStaffData(s);
        return data.job === 'ST' && !isExcluded(s);
      }).length;

      const hospital = safeStaff.filter(s => {
        const data = getStaffData(s);
        const isAssistant = data.job === '助手' || data.role === '助手' || data.placement === '助手';
        const isVisit = data.role === '訪問リハ' || data.placement === '訪問' || data.placement === '訪問リハ';
        const isInactive = data.status === '長期休暇' || data.status === '入職前';
        return !isAssistant && !isVisit && !isInactive;
      }).length;

      const visit = safeStaff.filter(s => {
        const data = getStaffData(s);
        return data.status !== '長期休暇' && data.status !== '入職前' && 
               (data.role === '訪問リハ' || data.placement === '訪問' || data.placement === '訪問リハ');
      }).length;

      const assistant = safeStaff.filter(s => {
        const data = getStaffData(s);
        return data.status !== '長期休暇' && data.status !== '入職前' && 
               (data.job === '助手' || data.role === '助手' || data.placement === '助手');
      }).length;

      const inactive = safeStaff.filter(s => {
        const data = getStaffData(s);
        return data.status === '長期休暇';
      }).length;

      const hokatsuCount = safeStaff.filter(s => {
        const data = getStaffData(s);
        return data.status !== '長期休暇' && data.status !== '入職前' && 
               (data.role === '包括' || data.placement === '包括' || data.job === '包括');
      }).length;

      const hainyoCount = safeStaff.filter(s => {
        const data = getStaffData(s);
        return data.status !== '長期休暇' && data.status !== '入職前' && 
               (data.role === '排尿' || data.role === '排尿支援' || data.placement === '排尿' || data.placement === '排尿支援');
      }).length;
      
      return { inactive, assistant, visit, hospital, ptCount, otCount, stCount, hokatsuCount, hainyoCount };
    }, [safeStaff]);

    // ---------------------------------------------------------
    // 3. 部署別集計 (院内内訳)
    // ---------------------------------------------------------
    const hospitalCounts = hospitalPlacements.map(label => {
      return {
        label,
        count: safeStaff.filter(s => {
          const data = getStaffData(s);
          const isInactive = data.status === '長期休暇' || data.status === '入職前';
          if (isInactive) return false;
          
          const p = data.placement || '';
          const r = data.role || '';
          
          if (label === '２F') return p === '2F' || p === '２F';
          if (label === '４F') return p === '4F' || p === '４F';
          if (label === '排尿') return p.includes('排尿') || r.includes('排尿');
          if (label === '訪問リハ') return p.includes('訪問') || r.includes('訪問');
          if (label === '助手') return data.job === '助手' || p === '助手' || r === '助手';
          
          return p === label || r === label;
        }).length
      };
    });

    // ---------------------------------------------------------
    // 4. 出勤状況の判定
    // ---------------------------------------------------------
    const isWorkingToday = (staffName: string) => {
      const todayStr = getDateStr(new Date());
      const shift = (requests || []).find(r => r.staffName?.trim() === staffName.trim() && r.date === todayStr && r.status === 'approved');
      return !!shift && shift.type === '出勤';
    };

    const hospitalAttending = safeStaff.filter(s => {
      const data = getStaffData(s);
      const isOut = data.status === '長期休暇' || data.status === '入職前';
      return isWorkingToday(s.name) && 
             (hospitalPlacements.includes(data.placement) || data.placement === '院内' || ['包括', '排尿', '排尿支援'].includes(data.placement)) &&
             data.job !== '助手' &&
             !isOut;
    }).length;

    // ---------------------------------------------------------
    // 5. 制限人数の算出
    // ---------------------------------------------------------
    const today = new Date();
    const dayType = getDayType(today);
    const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthly = monthlyLimits[monthStr] || { 
      weekday: weekdayLimit, sat: saturdayLimit, sun: sundayLimit, pub: publicHolidayLimit 
    };

    const rawLimit = dayType === 'weekday' ? currentMonthly.weekday : 
                         dayType === 'sat' ? currentMonthly.sat :
                         dayType === 'sun' ? currentMonthly.sun :
                         currentMonthly.pub;
    const currentLimit = Number(rawLimit) || (dayType === 'weekday' ? 12 : 1);

    // ---------------------------------------------------------
    // 6. 表示用配列の構築
    // ---------------------------------------------------------
    const professionCounts = [
      { label: 'PT', count: stats.ptCount, color: COLORS.primary },
      { label: 'OT', count: stats.otCount, color: '#10b981' },
      { label: 'ST', count: stats.stCount, color: '#f59e0b' },
      { label: '包括', count: stats.hokatsuCount, color: '#ec4899' },
      { label: '排尿支援', count: stats.hainyoCount, color: '#f43f5e' },
    ];

    return (
      <SafeAreaView style={styles.container}>
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
            <View>
              <ThemeText variant="h1">ダッシュボード</ThemeText>
              <ThemeText variant="caption" color={isAdminAuthenticated ? COLORS.primary : COLORS.textSecondary}>
                {profile?.name || 'スタッフ'} - {isAdminAuthenticated ? '管理者権限' : '一般権限'}
              </ThemeText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity 
                onPress={onLogout}
                style={{ padding: 10, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 14 }}
                activeOpacity={0.7}
              >
                <LogOut size={22} color="#ef4444" />
              </TouchableOpacity>
            </View>
          </View>

          {/* --- [NEW] マイスケジュール セクション (個人カレンダー) --- */}
          {profile && (
            <View style={{ marginBottom: SPACING.xl }}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <CalendarIcon color={COLORS.primary} size={18} />
                  <ThemeText variant="h2">マイスケジュール</ThemeText>
                </View>
              </View>
              <ThemeCard style={styles.personalCard}>
                <View style={styles.personalHeader}>
                  <View style={styles.avatarMini}>
                    <ThemeText bold color="white">{profile.name?.substring(0, 1)}</ThemeText>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <ThemeText bold variant="body">{profile.name} さん</ThemeText>
                    <ThemeText variant="caption" color={COLORS.textSecondary}>{profile.jobType || profile.profession} / {profile.placement}</ThemeText>
                  </View>
                  <TouchableOpacity 
                    onPress={() => onNavigateToStaff ? onNavigateToStaff('my-calendar') : null}
                    style={styles.personalCalendarBtn}
                  >
                    <ThemeText variant="caption" color={COLORS.primary} bold>詳細カレンダー</ThemeText>
                  </TouchableOpacity>
                </View>
                
                <View style={styles.personalScheduleRow}>
                  {[0, 1, 2].map(offset => {
                    const target = new Date();
                    target.setDate(target.getDate() + offset);
                    const dStr = getDateStr(target);
                    const dayType = getDayType(target);
                    
                    const shift = (requests || []).find(r => 
                      (r.staff_id === profile.id || r.staffName === profile.name) && 
                      r.date === dStr && 
                      r.status === 'approved'
                    );
                    
                    const type = shift ? shift.type : (dayType === 'weekday' ? '出勤' : '公休');
                    const isOff = ['公休', '年休', '休暇', '欠勤'].includes(type);
                    
                    return (
                      <View key={offset} style={styles.scheduleItem}>
                        <ThemeText variant="caption" color={COLORS.textSecondary}>
                          {offset === 0 ? '今日' : offset === 1 ? '明日' : '明後日'}
                        </ThemeText>
                        <View style={[styles.scheduleBadge, { backgroundColor: isOff ? 'rgba(239, 68, 68, 0.1)' : 'rgba(14, 165, 233, 0.1)' }]}>
                          <ThemeText bold style={{ fontSize: 13, color: isOff ? '#ef4444' : '#0ea5e9' }}>{type}</ThemeText>
                        </View>
                        <ThemeText style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>{target.getMonth()+1}/{target.getDate()}</ThemeText>
                      </View>
                    );
                  })}
                </View>
              </ThemeCard>
            </View>
          )}
          
          {/* 申請承認通知（管理者のみ） */}
          {((profile?.role?.includes('シフト管理者') || profile?.role?.includes('開発者')) || isAdminAuthenticated) && (
            (() => {
              const pendingCount = (requests || []).filter(r => r.status === 'pending').length;
              if (pendingCount > 0) {
                return (
                  <TouchableOpacity onPress={onOpenRequests} style={styles.notificationBanner} activeOpacity={0.8}>
                    <View style={styles.notificationIcon}><AlertCircle color="#ffffff" size={20} /></View>
                    <View style={{ flex: 1 }}>
                      <ThemeText bold style={{ color: '#ffffff' }}>承認待ちの申請があります</ThemeText>
                      <ThemeText variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>現在 {pendingCount} 件の申請が入っています</ThemeText>
                    </View>
                    <ChevronRight color="#ffffff" size={20} />
                  </TouchableOpacity>
                );
              }
              return null;
            })()
          )}

          {/* 職種別人数 */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Users color={COLORS.primary} size={18} />
              <ThemeText variant="h2">職種別人数（院内主要部署）</ThemeText>
            </View>
          </View>
          <ThemeCard style={styles.professionsContainer}>
            {professionCounts.map((item) => (
              <View key={item.label} style={styles.professionItem}>
                <View style={[styles.profIndicator, { backgroundColor: item.color }]} />
                <ThemeText variant="body" bold style={{ flex: 1, marginRight: 8 }} adjustsFontSizeToFit numberOfLines={1}>{item.label}</ThemeText>
                <ThemeText variant="h2">{item.count}<ThemeText variant="caption"> 名</ThemeText></ThemeText>
              </View>
            ))}
          </ThemeCard>

          {/* サマリーカード */}
          <View style={styles.summaryRow}>
            <ThemeCard style={styles.summaryCard}>
              <View style={styles.summaryIcon}><Users color={COLORS.primary} size={20} /></View>
              <ThemeText variant="label">院内合計</ThemeText>
              <ThemeText variant="h2">{stats.hospital}<ThemeText variant="caption" color={COLORS.textSecondary}> 名</ThemeText></ThemeText>
            </ThemeCard>
            <ThemeCard style={[styles.summaryCard, { borderColor: '#a855f7', borderWidth: 1 }]}>
              <View style={[styles.summaryIcon, { backgroundColor: 'rgba(168, 85, 247, 0.1)' }]}><Coffee color="#a855f7" size={20} /></View>
              <ThemeText variant="label">長期休暇</ThemeText>
              <ThemeText variant="h2">{stats.inactive}<ThemeText variant="caption"> 名</ThemeText></ThemeText>
            </ThemeCard>
          </View>

          {/* 院内内訳グリッド */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Building2 color={COLORS.primary} size={18} />
              <ThemeText variant="h2">スタッフ配置内訳</ThemeText>
            </View>
          </View>
          <View style={styles.grid}>
            {hospitalCounts.map((item) => (
              <TouchableOpacity key={item.label} style={styles.gridCardWrapper} onPress={() => setSelectedWardDetails(item.label)} activeOpacity={0.7}>
                <ThemeCard style={styles.gridCard}>
                  <ThemeText variant="label" style={styles.cardLabel}>{item.label}</ThemeText>
                  <View style={styles.valueRow}>
                    <ThemeText variant="h2">{item.count}</ThemeText>
                    <ThemeText variant="caption" style={{ marginLeft: 4 }}>名在籍</ThemeText>
                  </View>
                </ThemeCard>
              </TouchableOpacity>
            ))}
          </View>

          {/* 詳細（ドリルダウン）モーダル */}
          <Modal visible={!!selectedWardDetails} transparent animationType="fade" onRequestClose={() => setSelectedWardDetails(null)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <View style={styles.modalTitleRow}>
                    <Building2 color={COLORS.primary} size={20} />
                    <ThemeText variant="h2" style={{ marginLeft: 8 }}>{selectedWardDetails} 出勤スタッフ</ThemeText>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedWardDetails(null)}><X color={COLORS.textSecondary} size={24} /></TouchableOpacity>
                </View>
                <ScrollView style={styles.staffListScroll}>
                  {sortStaffByName(safeStaff.filter(s => {
                    const data = getStaffData(s);
                    return (data.placement === selectedWardDetails || (selectedWardDetails === '外来' && data.placement === '院内')) && isWorkingToday(s.name);
                  })).map((staff, idx) => (
                      <View style={{ flex: 1 }}>
                        <ThemeText variant="body" bold adjustsFontSizeToFit numberOfLines={1}>{staff.name}{staff.placement === '訪問' ? ' (訪問リハ)' : ''}</ThemeText>
                        <ThemeText variant="caption" color={COLORS.textSecondary} adjustsFontSizeToFit numberOfLines={1}>
                          {getStaffData(staff).role} / {getStaffData(staff).job}
                        </ThemeText>
                      </View>
                    ))}
                  {safeStaff.filter(s => getStaffData(s).placement === selectedWardDetails && isWorkingToday(s.name)).length === 0 && (
                    <View style={{ padding: 40, alignItems: 'center' }}><ThemeText color={COLORS.textSecondary}>現在、出勤予定の職員はいません</ThemeText></View>
                  )}
                </ScrollView>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedWardDetails(null)}><ThemeText color={COLORS.primary} bold>閉じる</ThemeText></TouchableOpacity>
              </View>
            </View>
          </Modal>
        </ScrollView>
      </SafeAreaView>
    );
  } catch (error) {
    console.error("HomeScreen Critical Failure:", error);
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background, padding: 20, justifyContent: 'center' }}>
        <ThemeCard style={{ padding: 24, borderColor: '#ef4444', borderWidth: 2, borderRadius: 24 }}>
          <ThemeText variant="h2" style={{ color: '#ef4444', marginBottom: 16 }}>レンダリングエラーが発生しました</ThemeText>
          <ThemeText style={{ marginBottom: 24, lineHeight: 22 }}>
            データの不整合により画面を表示できません。以下のボタンでクラウドから最新データを強制取得して復旧を試みてください。
          </ThemeText>
          
          <TouchableOpacity 
            onPress={async () => {
              console.log("[RECOVERY_BUTTON] Triggered");
              if (onForceCloudSync) {
                await onForceCloudSync();
                if (Platform.OS === 'web') window.location.reload();
              }
            }} 
            style={{ backgroundColor: COLORS.primary, padding: 18, borderRadius: 16, alignItems: 'center', marginBottom: 12 }}
          >
            <ThemeText bold color="white">クラウドから最新データを強制取得</ThemeText>
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => {
              if (Platform.OS === 'web') {
                localStorage.clear();
                window.location.reload();
              }
            }} 
            style={{ backgroundColor: '#ef4444', padding: 18, borderRadius: 16, alignItems: 'center' }}
          >
            <ThemeText bold color="white">キャッシュを全消去して初期化</ThemeText>
          </TouchableOpacity>
        </ThemeCard>
      </SafeAreaView>
    );
  }
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
  scrollContent: { 
    padding: SPACING.md, 
    width: '100%',
    alignItems: 'stretch'
  },
  header: { 
    marginBottom: SPACING.lg, 
    marginTop: SPACING.md, 
    width: '100%',
    alignItems: 'stretch',
    alignSelf: 'stretch'
  },
  summaryRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xl, width: '100%' },
  summaryCard: { flex: 1, padding: SPACING.sm, alignItems: 'flex-start', gap: 2 },
  summaryIcon: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 6, borderRadius: BORDER_RADIUS.md, marginBottom: 2 },
  sectionHeader: { marginBottom: SPACING.md, marginTop: SPACING.sm, width: '100%' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, marginBottom: SPACING.xl, width: '100%' },
  gridCardWrapper: { width: '100%' },
  gridCard: { width: '100%', padding: SPACING.md, alignItems: 'flex-start' },
  cardLabel: { color: COLORS.textSecondary, marginBottom: 4 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  professionsContainer: { padding: SPACING.md, marginBottom: SPACING.xl, width: '100%' },
  professionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', width: '100%' },
  profIndicator: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20, width: '100%' },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 24, padding: 24, width: '100%', maxHeight: '80%', borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingBottom: 12, width: '100%' },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center' },
  staffListScroll: { marginBottom: 10, width: '100%' },
  staffListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)', gap: 12, width: '100%' },
  staffAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(56, 189, 248, 0.1)', justifyContent: 'center', alignItems: 'center' },
  closeBtn: { marginTop: 12, padding: 12, alignItems: 'center', width: '100%' },
  notificationBanner: {
    backgroundColor: '#ef4444',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.lg,
    gap: 12,
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    width: '100%'
  },
  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239, 68, 68, 0.1)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  personalCard: { padding: 16, borderRadius: 24, backgroundColor: 'rgba(56, 189, 248, 0.05)', borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.1)', width: '100%' },
  personalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, width: '100%' },
  personalCalendarBtn: { backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  personalScheduleRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 18, padding: 12, width: '100%' },
  scheduleItem: { flex: 1, alignItems: 'center' },
  scheduleBadge: { marginTop: 6, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  personalAccountBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: SPACING.md, padding: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', width: '100%' },
  avatarMini: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
});
