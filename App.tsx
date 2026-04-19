import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, SafeAreaView, Alert, Platform, AppState, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Home, Calendar, User, ClipboardList, Users, Shield, RefreshCw } from 'lucide-react-native';
import { ThemeCard } from './src/components/ThemeCard';
import { HomeScreen } from './src/screens/HomeScreen';
import { CalendarScreen } from './src/screens/CalendarScreen';
import { RequestScreen } from './src/screens/RequestScreen';
import { StaffScreen } from './src/screens/StaffScreen';
import { AdminScreen } from './src/screens/AdminScreen';
import { AdminRequestScreen } from './src/screens/AdminRequestScreen';
import { QrShareScreen } from './src/screens/QrShareScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ThemeText } from './src/components/ThemeText';
import { COLORS, SPACING } from './src/theme/theme';
import { getDateStr } from './src/utils/dateUtils';
import { useAppLogic } from './src/hooks/useAppLogic';

// deduplicateRequests was moved here from old App.tsx to keep ea1151d logic if needed, 
// but useAppLogic already handles internal state. 
// We will use useAppLogic's properties.

export default function App() {
  const logic = useAppLogic();
  
  const {
    currentTab, setCurrentTab,
    showSetup, setShowSetup,
    staffList, setStaffList,
    requests, setRequests,
    profile, setProfile,
    weekdayLimit, saturdayLimit, sundayLimit, publicHolidayLimit,
    monthlyLimits, updateLimits,
    adminPassword, updatePassword,
    isAdminAuthenticated, setIsAdminAuthenticated,
    staffViewMode, setStaffViewMode,
    sessionDuration, setSessionDuration,
    isInitialized, isSyncing,
    activeDate, setActiveDate,
    holidayLimit,
    handleLogout,
    handleForceCloudSync,
    onSubmitRequest,
    cancelRequest,
    approveRequest,
    onDeleteRequest,
    onAutoAssign,
    onUndoAutoAssign,
    canUndoAutoAssign,
  } = logic;

  const renderContent = () => {
    const commonProps = {
      staffList, setStaffList,
      requests, setRequests,
      onDeleteRequest,
      onDeleteRequests: async (ids: string[]) => {
        for (const id of ids) {
          await onDeleteRequest(id);
        }
      },
      approveRequest,
      profile, setProfile,
      weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit,
      monthlyLimits, updateLimits,
      adminPassword, updatePassword,
      isAdminAuthenticated, setIsAdminAuthenticated,
      onOpenRequests: () => setCurrentTab('adminRequests'),
      onShareApp: () => setCurrentTab('qrShare'),
      onLogout: handleLogout,
      staffViewMode,
      setStaffViewMode,
      sessionDuration,
      setSessionDuration,
      onForceCloudSync: handleForceCloudSync,
      currentDate: activeDate, setCurrentDate: setActiveDate,
      onAutoAssign,
      onUndoAutoAssign,
      canUndoAutoAssign,
    };

    switch (currentTab) {
      case 'home': return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...commonProps} />;
      case 'calendar': return <CalendarScreen {...commonProps} />;
      case 'requests': return <RequestScreen {...commonProps} />;
      case 'staff': return <StaffScreen {...commonProps} isPrivileged={isAdminAuthenticated} />;
      case 'admin': return <AdminScreen {...commonProps} />;
      case 'adminRequests': return <AdminRequestScreen onBack={() => setCurrentTab('admin')} requests={requests} approveRequest={approveRequest} deleteRequest={onDeleteRequest} />;
      case 'qrShare': return <QrShareScreen onBack={() => setCurrentTab('admin')} />;
      default: return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...commonProps} />;
    }
  };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.buildBanner}>
          <ThemeText style={styles.buildBannerText}>[BUILD: VERSION 11.0 - CANCEL APPROVAL FIXED]</ThemeText>
        </View>
        {!profile ? (
          showSetup ? (
            <SetupScreen onComplete={setProfile} onBack={() => setShowSetup(false)} />
          ) : (
            <LoginScreen staffList={staffList} onLogin={setProfile} onGoToSetup={() => setShowSetup(true)} />
          )
        ) : profile.isApproved === false ? (
          <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
            <View style={{ width: '100%', alignItems: 'center' }}>
              <ThemeCard style={{ padding: 40, width: '100%', alignItems: 'center', borderRadius: 32 }}>
                <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.1)', padding: 24, borderRadius: 100, marginBottom: 24 }}>
                  <Shield size={48} color={COLORS.primary} />
                </View>
                <ThemeText variant="h1" style={{ marginBottom: 12, textAlign: 'center' }}>登録承認待ち</ThemeText>
                <ThemeText variant="body" color={COLORS.textSecondary} style={{ textAlign: 'center', lineHeight: 24, marginBottom: 32 }}>
                  {profile.name} さんの登録申請を送信しました。{"\n"}
                  管理者が承認するまで、しばらくお待ちください。{"\n"}
                  （承認後にアプリが利用可能になります）
                </ThemeText>
                
                <TouchableOpacity 
                  style={{ backgroundColor: COLORS.primary, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', opacity: isSyncing ? 0.7 : 1 }}
                  disabled={isSyncing}
                  onPress={async () => {
                    const success = await handleForceCloudSync();
                    if (success) {
                      Alert.alert('確認', '最新のステータスを確認しました。');
                    }
                  }}
                >
                  {isSyncing ? (
                    <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                  ) : (
                    <RefreshCw size={20} color="white" style={{ marginRight: 8 }} />
                  )}
                  <ThemeText bold color="white">{isSyncing ? '確認中...' : '最新の状態に更新'}</ThemeText>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={{ marginTop: 40 }}
                  onPress={handleLogout}
                >
                  <ThemeText color="#ef4444">入力をやり直す (ログアウト)</ThemeText>
                </TouchableOpacity>
              </ThemeCard>
            </View>
          </SafeAreaView>
        ) : (
          <>
            <View style={styles.content}>{renderContent()}</View>
            <SafeAreaView style={styles.tabBarContainer}>
              <View style={styles.tabBar}>
                {[
                  { id: 'home', icon: Home, label: 'ホーム' },
                  { id: 'calendar', icon: Calendar, label: '出勤' },
                  { id: 'staff', icon: Users, label: '職員' },
                  { id: 'requests', icon: ClipboardList, label: '申請' },
                  { id: 'admin', icon: (profile.role?.includes('管理者') || profile.role?.includes('開発者')) ? Shield : User, label: (profile.role?.includes('管理者') || profile.role?.includes('開発者')) ? '管理・設定' : '設定' }
                ].map(tab => (
                  <TouchableOpacity key={tab.id} style={styles.tabItem} onPress={() => setCurrentTab(tab.id)} activeOpacity={0.7}>
                    <tab.icon size={24} color={currentTab === tab.id ? COLORS.primary : COLORS.textSecondary} />
                    <ThemeText variant="caption" style={{ marginTop: 4, fontSize: 9, color: currentTab === tab.id ? COLORS.primary : COLORS.textSecondary }}>{tab.label}</ThemeText>
                  </TouchableOpacity>
                ))}
              </View>
            </SafeAreaView>
          </>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  buildBanner: { backgroundColor: '#1e293b', paddingVertical: 4, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#334155' },
  buildBannerText: { color: COLORS.primary, fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  content: { flex: 1 },
  tabBarContainer: { backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border },
  tabBar: { flexDirection: 'row', height: 60, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 8 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 8 },
});
