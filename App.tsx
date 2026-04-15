// @ts-nocheck
import React from 'react';
import { StyleSheet, View, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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
import { COLORS } from './src/theme/theme';
import { useAppLogic } from './src/hooks/useAppLogic';
import { cloudStorage } from './src/utils/cloudStorage';
import { STORAGE_KEYS, saveData } from './src/utils/storage';

export default function App() {
  const logic = useAppLogic();
  const { 
    currentTab, setCurrentTab, showSetup, setShowSetup, profile, isInitialized, isSyncing,
    isAdminAuthenticated, setIsAdminAuthenticated, staffList, requests, activeDate, setActiveDate,
    handleUpdateProfile, handleLogout, handleForceCloudSync
  } = logic;

  if (!isInitialized) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const renderContent = () => {
    // 巨大なプロップスオブジェクトの型推論によるビルドエラー（Stack Overflow）を避けるため、anyでキャスト
    const props: any = { ...logic, currentDate: activeDate, setCurrentDate: setActiveDate, isPrivileged: isAdminAuthenticated };

    switch (currentTab) {
      case 'home': return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...props} />;
      case 'calendar': return <CalendarScreen {...props} onForceSave={logic.handleForceSave} onForceFetch={logic.handleForceFetch} />;
      case 'requests': return <RequestScreen {...props} />;
      case 'staff': return <StaffScreen {...props} />;
      case 'admin': return <AdminScreen {...props} onForceSave={logic.handleForceSave} onForceFetch={logic.handleForceFetch} />;
      case 'adminRequests': return <AdminRequestScreen onBack={() => setCurrentTab('admin')} requests={logic.requests} approveRequest={async (id: string, s: string) => {
        const req = logic.requests.find(r => r.id === id);
        if (req) {
          const updated = { ...req, status: s };
          await logic.updateRequests(prev => prev.map(r => r.id === id ? updated : r));
        }
      }} deleteRequest={(id: string) => logic.onDeleteRequests([id])} />;
      case 'qrShare': return <QrShareScreen onBack={() => setCurrentTab('admin')} />;
      default: return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...props} />;
    }
  };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        {!profile ? (
          showSetup ? (
            <SetupScreen onComplete={handleUpdateProfile} onBack={() => setShowSetup(false)} />
          ) : (
            <LoginScreen staffList={staffList} onLogin={handleUpdateProfile} onGoToSetup={() => setShowSetup(true)} />
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
                   管理者が承認するまでお待ちください。
                </ThemeText>
                
                <TouchableOpacity 
                   style={styles.refreshBtn}
                   disabled={isSyncing}
                   onPress={() => handleForceCloudSync()}
                >
                   {isSyncing ? <ActivityIndicator size="small" color="white" /> : <RefreshCw size={20} color="white" />}
                   <ThemeText bold color="white" style={{ marginLeft: 8 }}>{isSyncing ? '確認中...' : '状態を更新'}</ThemeText>
                </TouchableOpacity>

                <TouchableOpacity style={{ marginTop: 40 }} onPress={handleLogout}>
                   <ThemeText color="#ef4444">ログアウト</ThemeText>
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
  content: { flex: 1 },
  tabBarContainer: { backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border },
  tabBar: { flexDirection: 'row', height: 60, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 8 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 8 },
  refreshBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center' }
});
