import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, SafeAreaView, TouchableOpacity, Modal } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { Users, Coffee, Briefcase, Building2, MapPin, X, RefreshCw, AlertCircle, ChevronRight } from 'lucide-react-native';
import { getDayType, getDateStr, normalizeName } from '../utils/dateUtils';
import { sortStaffByName } from '../utils/staffUtils';

interface HomeScreenProps {
  onNavigateToStaff?: (ward: string) => void;
  staffList: any[];
  requests: any[];
  weekdayLimit: number;
  holidayLimit: number;
  saturdayLimit: number;
  sundayLimit: number;
  publicHolidayLimit: number;
  monthlyLimits: Record<string, { weekday: number, sat: number, sun: number, pub: number }>;
  staffViewMode?: boolean;
  onForceCloudSync?: () => Promise<boolean>;
  profile?: any;
  isAdminAuthenticated?: boolean;
  onOpenRequests?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ 
  onNavigateToStaff, staffList, requests, weekdayLimit, holidayLimit,
  saturdayLimit, sundayLimit, publicHolidayLimit, monthlyLimits, staffViewMode = false,
  onForceCloudSync, profile, isAdminAuthenticated, onOpenRequests
}) => {
  const [selectedWardDetails, setSelectedWardDetails] = useState<string | null>(null);
  const [isLeaveModalVisible, setIsLeaveModalVisible] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const hospitalPlacements = ['2F', '4F', '外来', 'フォロー', '兼務', '管理'];
  
  const today = new Date();
  const dayType = getDayType(today);
  
  const attendanceTypes = ['出勤', '午前休', '午後休', '時間休', '午前振替', '午後振替', '特休', '看護休暇'];

  // Helper to determine if a staff member is working today based on shift requests
  // Aligned with CalendarScreen.tsx logic
  const isWorkingToday = (staffName: string) => {
    const todayStr = getDateStr(new Date());
    const userReqs = requests.filter(r => normalizeName(r.staffName || r.staff_name) === normalizeName(staffName) && r.date === todayStr);
    
    // Check approved first, then pending as fallback (matches CalendarScreen logic)
    const approved = userReqs.find(r => r.status === 'approved');
    const pending = userReqs.find(r => r.status === 'pending');
    const shift = approved || pending;

    if (shift) {
      return attendanceTypes.some(at => normalizeName(at) === normalizeName(shift.type));
    }
    // If no explicit shift exists, standard staff default to Working on weekdays, Off on weekends.
    return dayType === 'weekday';
  };

  const isStaffOut = (s: any) => {
    const status = normalizeName(s.status || '');
    const placement = normalizeName(s.placement || '');
    const position = normalizeName(s.position || '');
    return status === '長期休暇' || placement === '長期休暇' || position === '長期休暇' || status === '入職前';
  };

  const hospitalCounts = hospitalPlacements.map(label => {
    return {
      label,
      count: staffList.filter(s => {
        const isOut = isStaffOut(s);
        return s.placement === label && s.profession !== '助手' && !isOut;
      }).length
    };
  });

  const outStaffCount = staffList.filter(s => isStaffOut(s)).length;
  const assistantCount = staffList.filter(s => {
    const isOut = isStaffOut(s);
    return (s.profession === '助手' || s.placement === '助手') && !isOut;
  }).length;
  const totalVisits = staffList.filter(s => {
    const isOut = isStaffOut(s);
    return s.placement === '訪問' && !isOut;
  }).length;

  const hospitalEligible = staffList.filter(s => {
    const isOut = isStaffOut(s);
    return hospitalPlacements.includes(s.placement) && !isOut && s.profession !== '助手';
  });
  
  const ptCount = hospitalEligible.filter(s => s.profession === 'PT').length;
  const otCount = hospitalEligible.filter(s => s.profession === 'OT').length;
  const stCount = hospitalEligible.filter(s => s.profession === 'ST').length;
  const hokatsuCount = staffList.filter(s => {
    const isOut = isStaffOut(s);
    return s.placement === '包括' && !isOut;
  }).length;
  const hainyoCount = staffList.filter(s => {
    const isOut = isStaffOut(s);
    return s.placement === '排尿支援' && !isOut;
  }).length;

  const totalHospital = ptCount + otCount + stCount + hokatsuCount + hainyoCount;

  // 1. 出勤者数 (訪問と助手を抜いた数)
  const attendingStaffCount = staffList.filter(s => {
    const isOut = isStaffOut(s);
    const isVisitorOrAssistant = s.placement === '訪問' || s.profession === '助手' || s.placement === '助手';
    return isWorkingToday(s.name) && !isVisitorOrAssistant && !isOut;
  }).length;

  // 2. 休暇者数 (全員、長期休暇含む)
  const leaveStaffList = staffList.filter(s => !isWorkingToday(s.name) || isStaffOut(s));
  const leaveStaffCount = leaveStaffList.length;

  const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthly = monthlyLimits[monthStr] || { 
    weekday: weekdayLimit, sat: saturdayLimit, sun: sundayLimit, pub: publicHolidayLimit 
  };

  const currentLimit = dayType === 'weekday' ? currentMonthly.weekday : 
                       dayType === 'sat' ? currentMonthly.sat :
                       dayType === 'sun' ? currentMonthly.sun :
                       currentMonthly.pub;

  const professionCounts = [
    { label: 'PT', count: ptCount, color: '#0ea5e9' },
    { label: 'OT', count: otCount, color: '#f59e0b' },
    { label: 'ST', count: stCount, color: '#10b981' },
    { label: '助手', count: assistantCount, color: '#6366f1' },
    { label: '長期休暇/入職前', count: outStaffCount, color: '#a855f7' },
    { label: '包括', count: hokatsuCount, color: '#ec4899' },
    { label: '排尿支援', count: hainyoCount, color: '#f43f5e' },
    { label: 'その他', count: hospitalEligible.filter(s => !['PT', 'OT', 'ST'].includes(s.profession)).length, color: COLORS.textSecondary },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <ThemeText variant="h1">ダッシュボード</ThemeText>
          {onForceCloudSync && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {syncMsg ? <ThemeText variant="caption" style={{ color: COLORS.primary }}>{syncMsg}</ThemeText> : null}
              <TouchableOpacity onPress={async () => {
                setSyncMsg('更新中...');
                const success = await onForceCloudSync();
                setSyncMsg(success ? '更新しました' : 'エラー');
                setTimeout(() => setSyncMsg(''), 3000);
              }} style={{ padding: 8, backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: 12 }}>
                <RefreshCw size={20} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        
        {/* Pending Approval Notification for Managers */}
        {((profile?.role?.includes('シフト管理者') || profile?.role?.includes('開発者')) || isAdminAuthenticated) && (
          (() => {
            const pendingCount = requests.filter(r => r.status === 'pending').length;
            if (pendingCount > 0) {
              return (
                <TouchableOpacity 
                  onPress={onOpenRequests}
                  style={styles.notificationBanner}
                  activeOpacity={0.8}
                >
                  <View style={styles.notificationIcon}>
                    <AlertCircle color="#ffffff" size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemeText bold style={{ color: '#ffffff' }}>承認待ちの申請があります</ThemeText>
                    <ThemeText variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
                      現在 {pendingCount} 件の申請が入っています
                    </ThemeText>
                  </View>
                  <ChevronRight color="#ffffff" size={20} />
                </TouchableOpacity>
              );
            }
            return null;
          })()
        )}

        {/* Today's Status Summary */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Coffee color={COLORS.primary} size={18} />
            <ThemeText variant="h2">本日の状況</ThemeText>
          </View>
        </View>
        <View style={styles.summaryRow}>
          <ThemeCard style={[styles.summaryCard, { borderColor: COLORS.primary, borderWidth: 1 }]}>
            <ThemeText variant="label">出勤者数</ThemeText>
            <ThemeText variant="h2" style={{ color: COLORS.primary }}>
              {attendingStaffCount}<ThemeText variant="caption"> 名</ThemeText>
            </ThemeText>
            <ThemeText variant="caption" color={COLORS.textSecondary}>※訪問・助手を抜く</ThemeText>
          </ThemeCard>

          <TouchableOpacity style={{ flex: 1 }} onPress={() => setIsLeaveModalVisible(true)}>
            <ThemeCard style={[styles.summaryCard, { borderColor: '#f87171', borderWidth: 1 }]}>
              <ThemeText variant="label">休暇者数</ThemeText>
              <ThemeText variant="h2" style={{ color: '#f87171' }}>
                {leaveStaffCount}<ThemeText variant="caption"> 名</ThemeText>
              </ThemeText>
              <ThemeText variant="caption" color={COLORS.textSecondary}>タップで一覧表示</ThemeText>
            </ThemeCard>
          </TouchableOpacity>
        </View>

        {/* Attendance Limit Info */}
        {(dayType === 'weekday' || dayType === 'sat') && (
          <ThemeCard style={{ padding: SPACING.md, marginBottom: SPACING.xl, backgroundColor: 'rgba(56, 189, 248, 0.05)', borderColor: 'rgba(56, 189, 248, 0.2)', borderWidth: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <ThemeText variant="body">本日の出勤制限: <ThemeText bold>{currentLimit}名</ThemeText></ThemeText>
              <ThemeText variant="body" color={attendingStaffCount > currentLimit ? '#ef4444' : '#10b981'}>
                {attendingStaffCount > currentLimit ? `制限オーバー (${attendingStaffCount - currentLimit}名)` : '制限内'}
              </ThemeText>
            </View>
          </ThemeCard>
        )}

        {/* Top Summary Cards (Enrollment) */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Users color={COLORS.primary} size={18} />
            <ThemeText variant="h2">在籍数状況</ThemeText>
          </View>
        </View>
        <View style={styles.summaryRow}>
          <ThemeCard style={styles.summaryCard}>
            <View style={styles.summaryIcon}>
              <Users color={COLORS.primary} size={20} />
            </View>
            <ThemeText variant="label">院内合計</ThemeText>
            <ThemeText variant="h2" style={{ color: COLORS.text }}>
              {totalHospital}<ThemeText variant="caption" color={COLORS.textSecondary}> 名</ThemeText>
            </ThemeText>
          </ThemeCard>

          <ThemeCard style={[styles.summaryCard, { borderColor: COLORS.accent, borderWidth: 1 }]}>
            <View style={[styles.summaryIcon, { backgroundColor: 'rgba(56, 189, 248, 0.1)' }]}>
              <MapPin color={COLORS.accent} size={20} />
            </View>
            <ThemeText variant="label">訪問合計</ThemeText>
            <ThemeText variant="h2">{totalVisits}<ThemeText variant="caption"> 名</ThemeText></ThemeText>
          </ThemeCard>
        </View>

        <View style={styles.summaryRow}>
          <ThemeCard style={[styles.summaryCard, { borderColor: '#10b981', borderWidth: 1 }]}>
            <View style={[styles.summaryIcon, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
              <Briefcase color="#10b981" size={20} />
            </View>
            <ThemeText variant="label">助手合計</ThemeText>
            <ThemeText variant="h2">{assistantCount}<ThemeText variant="caption"> 名</ThemeText></ThemeText>
          </ThemeCard>

          <ThemeCard style={[styles.summaryCard, { borderColor: '#a855f7', borderWidth: 1 }]}>
            <View style={[styles.summaryIcon, { backgroundColor: 'rgba(168, 85, 247, 0.1)' }]}>
              <Coffee color="#a855f7" size={20} />
            </View>
            <ThemeText variant="label">長期休暇/入職前</ThemeText>
            <ThemeText variant="h2">{outStaffCount}<ThemeText variant="caption"> 名</ThemeText></ThemeText>
          </ThemeCard>
        </View>

        {/* Profession Stats Section */}
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

        {/* Hospital Breakdown */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Building2 color={COLORS.primary} size={18} />
            <ThemeText variant="h2">院内内訳</ThemeText>
          </View>
        </View>
        
        <View style={styles.grid}>
          {hospitalCounts.map((item) => (
            <TouchableOpacity 
              key={item.label} 
              style={styles.gridCardWrapper} 
              onPress={() => setSelectedWardDetails(item.label)}
              activeOpacity={0.7}
            >
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

        {/* Hospital Drill-down Modal */}
        <Modal
          visible={!!selectedWardDetails}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedWardDetails(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleRow}>
                  <Building2 color={COLORS.primary} size={20} />
                  <ThemeText variant="h2" style={{ marginLeft: 8 }}>{selectedWardDetails} 出勤スタッフ</ThemeText>
                </View>
                <TouchableOpacity onPress={() => setSelectedWardDetails(null)}>
                  <X color={COLORS.textSecondary} size={24} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.staffListScroll}>
                {sortStaffByName(staffList
                  .filter(s => s.placement === selectedWardDetails && isWorkingToday(s.name)))
                  .map((staff, idx) => (
                    <View key={staff.id || idx} style={styles.staffListItem}>
                      <View style={styles.staffAvatar}>
                        <ThemeText bold color={COLORS.primary}>{staff.name[0]}</ThemeText>
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemeText variant="body" bold adjustsFontSizeToFit numberOfLines={1}>{staff.name}</ThemeText>
                        <ThemeText variant="caption" color={COLORS.textSecondary} adjustsFontSizeToFit numberOfLines={1}>{staff.position} / {staff.profession}</ThemeText>
                      </View>
                    </View>
                  ))}
                {staffList.filter(s => s.placement === selectedWardDetails && isWorkingToday(s.name)).length === 0 && (
                  <View style={{ padding: 40, alignItems: 'center' }}>
                    <ThemeText color={COLORS.textSecondary}>現在、出勤予定の職員はいません</ThemeText>
                  </View>
                )}
              </ScrollView>

              <TouchableOpacity 
                style={styles.closeBtn} 
                onPress={() => setSelectedWardDetails(null)}
              >
                <ThemeText color={COLORS.primary} bold>閉じる</ThemeText>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Leave List Modal */}
        <Modal
          visible={isLeaveModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setIsLeaveModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleRow}>
                  <Coffee color="#f87171" size={20} />
                  <ThemeText variant="h2" style={{ marginLeft: 8 }}>本日の休暇スタッフ</ThemeText>
                </View>
                <TouchableOpacity onPress={() => setIsLeaveModalVisible(false)}>
                  <X color={COLORS.textSecondary} size={24} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.staffListScroll}>
                {sortStaffByName(leaveStaffList)
                  .map((staff, idx) => (
                    <View key={staff.id || idx} style={styles.staffListItem}>
                      <View style={[styles.staffAvatar, { backgroundColor: 'rgba(248, 113, 113, 0.1)' }]}>
                        <ThemeText bold color="#f87171">{staff.name[0]}</ThemeText>
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemeText variant="body" bold adjustsFontSizeToFit numberOfLines={1}>{staff.name}</ThemeText>
                        <ThemeText variant="caption" color={COLORS.textSecondary} adjustsFontSizeToFit numberOfLines={1}>{staff.placement || '未設定'} / {staff.profession}</ThemeText>
                      </View>
                      {isStaffOut(staff) && (
                        <View style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                          <ThemeText variant="caption" color="#a855f7" bold>長期/入職前</ThemeText>
                        </View>
                      )}
                    </View>
                  ))}
                {leaveStaffList.length === 0 && (
                  <View style={{ padding: 40, alignItems: 'center' }}>
                    <ThemeText color={COLORS.textSecondary}>本日、休暇予定の職員はいません</ThemeText>
                  </View>
                )}
              </ScrollView>

              <TouchableOpacity 
                style={styles.closeBtn} 
                onPress={() => setIsLeaveModalVisible(false)}
              >
                <ThemeText color={COLORS.primary} bold>閉じる</ThemeText>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: SPACING.md },
  header: { marginBottom: SPACING.lg, marginTop: SPACING.md },
  summaryRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xl },
  summaryCard: { flex: 1, padding: SPACING.sm, alignItems: 'flex-start', gap: 2 },
  summaryIcon: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 6, borderRadius: BORDER_RADIUS.md, marginBottom: 2 },
  sectionHeader: { marginBottom: SPACING.md, marginTop: SPACING.sm },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, marginBottom: SPACING.xl },
  gridCardWrapper: { width: '47%' },
  gridCard: { width: '100%', padding: SPACING.md, alignItems: 'flex-start' },
  cardLabel: { color: COLORS.textSecondary, marginBottom: 4 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  professionsContainer: { padding: SPACING.md, marginBottom: SPACING.xl },
  professionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  profIndicator: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 24, padding: 24, width: '100%', maxHeight: '80%', borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingBottom: 12 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center' },
  staffListScroll: { marginBottom: 10 },
  staffListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)', gap: 12 },
  staffAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(56, 189, 248, 0.1)', justifyContent: 'center', alignItems: 'center' },
  closeBtn: { marginTop: 12, padding: 12, alignItems: 'center' },
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
  },
  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
