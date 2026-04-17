import React from 'react';
import { StyleSheet, View, TouchableOpacity, SafeAreaView, ActivityIndicator, Platform } from 'react-native';
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
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { COLORS } from './src/theme/theme';
import { useAppLogic } from './src/hooks/useAppLogic';
import { cloudStorage } from './src/utils/cloudStorage';
import { STORAGE_KEYS, saveData } from './src/utils/storage';

export default function App() {
  const logic = useAppLogic();
  const { 
    currentTab, setCurrentTab, showSetup, setShowSetup, profile, isInitialized, isSyncing, loadError,
    isAdminAuthenticated, setIsAdminAuthenticated, staffList, requests, activeDate, setActiveDate,
    handleUpdateProfile, handleLogout, handleForceCloudSync
  } = logic;

  // レジリエンス・ガード: 5秒以上初期化が終わらない場合、強制的に「起動済み」扱いにする
  const [hasTimedOut, setHasTimedOut] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (!isInitialized) {
        console.warn('App Resilience: Initialization taking too long, forcing UI display.');
        setHasTimedOut(true);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [isInitialized]);

  // エラー画面コンポーネント
  const renderErrorView = () => {
    const isDbError = loadError?.includes('データベース構成エラー');
    const isConfigMissing = !logic.isSupabaseConfigured;

    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        {!isConfigMissing && !isDbError && <ActivityIndicator size="large" color={COLORS.primary} />}
        <View style={{ marginTop: 24, alignItems: 'center', width: '100%' }}>
          <View style={{ backgroundColor: '#fee2e2', padding: 16, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#ef4444', marginBottom: 20, width: '100%' }}>
            <ThemeText variant="h3" style={{ color: '#991b1b', marginBottom: 8 }}>
              {isConfigMissing ? 'システム構成エラー' : 'エラーが発生しました'}
            </ThemeText>
            <ThemeText variant="body" style={{ color: '#b91c1c' }}>
              {isConfigMissing 
                ? 'Supabaseの環境変数が設定されていません。アプリを動作させるには初期設定が必要です。' 
                : loadError}
            </ThemeText>
          </View>

          {isConfigMissing && (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 12, marginBottom: 20, width: '100%', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)' }}>
              <ThemeText variant="caption" bold style={{ color: '#f87171', marginBottom: 12 }}>🔧 解決手順:</ThemeText>
              <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginBottom: 8 }}>
                1. ルートディレクトリに <ThemeText bold color="white">.env.local</ThemeText> ファイルを作成してください。
              </ThemeText>
              <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginBottom: 8 }}>
                2. 以下の変数を設定してください:
              </ThemeText>
              <View style={{ backgroundColor: '#1e293b', padding: 12, borderRadius: 8, marginTop: 4 }}>
                <ThemeText style={{ color: '#38bdf8', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                  EXPO_PUBLIC_SUPABASE_URL=...{"\n"}
                  EXPO_PUBLIC_SUPABASE_ANON_KEY=...
                </ThemeText>
              </View>
            </View>
          )}

          {isDbError && !isConfigMissing && (
            <View style={{ backgroundColor: '#f3f4f6', padding: 16, borderRadius: 8, marginBottom: 20, width: '100%' }}>
              <ThemeText variant="caption" bold style={{ color: '#374151', marginBottom: 8 }}>データベース構造の修復:</ThemeText>
              <ThemeText variant="caption" style={{ color: '#4b5563', marginBottom: 12 }}>
                SupabaseのSQL Editorで以下のコマンドを実行してください：
              </ThemeText>
              <View style={{ backgroundColor: '#1f2937', padding: 12, borderRadius: 6 }}>
                <ThemeText style={{ color: '#10b981', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12 }}>
                  ALTER TABLE staff ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
                </ThemeText>
              </View>
            </View>
          )}

          {!isConfigMissing && (
            <TouchableOpacity 
              style={[styles.refreshBtn, { backgroundColor: '#374151', paddingHorizontal: 24, height: 48, marginBottom: 12 }]} 
              onPress={() => Platform.OS === 'web' ? window.location.reload() : handleForceCloudSync()}
            >
              <RefreshCw size={18} color="white" />
              <ThemeText bold color="white" style={{ marginLeft: 8 }}>再試行 / リロード</ThemeText>
            </TouchableOpacity>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', opacity: 0.5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: logic.isSupabaseConfigured ? '#10b981' : '#ef4444', marginRight: 6 }} />
            <ThemeText variant="caption" style={{ fontSize: 10 }}>環境変数チェック: {logic.isSupabaseConfigured ? 'OK' : '未設定'}</ThemeText>
          </View>
        </View>
      </View>
    );
  };

  // 初期化未完了でも、タイムアウトが発生しているかエラーメッセージがある場合は表示を試みる
  if (!isInitialized && !hasTimedOut && !loadError) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <ThemeText style={{ marginTop: 16, color: COLORS.textSecondary }}>起動中...</ThemeText>
      </View>
    );
  }

  // エラーが発生している、またはタイムアウトしたがプロファイルがない場合
  if (loadError || (hasTimedOut && !profile)) {
    return renderErrorView();
  }

  const renderContent = () => {
    // 巨大なプロップスオブジェクトの型推論によるビルドエラー（Stack Overflow）を避けるため、anyでキャスト
    const props: any = { ...logic, currentDate: activeDate, setCurrentDate: setActiveDate, isPrivileged: isAdminAuthenticated };

    switch (currentTab) {
      case 'home': return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...props} />;
      case 'calendar': return <CalendarScreen {...props} onForceSave={logic.handleForceSave} onForceFetch={logic.handleForceFetch} />;
      case 'requests': return <RequestScreen {...props} />;
      case 'staff': return <StaffScreen {...props} />;
      case 'admin': return <AdminScreen {...props} onLogout={handleLogout} onForceSave={logic.handleForceSave} onForceFetch={logic.handleForceFetch} />;
      case 'adminRequests': return <AdminRequestScreen onBack={() => setCurrentTab('admin')} requests={logic.requests} approveRequest={logic.approveRequest} deleteRequest={(id: string) => logic.onDeleteRequests([id])} />;
      case 'qrShare': return <QrShareScreen onBack={() => setCurrentTab('admin')} />;
      default: return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...props} />;
    }
  };

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <View style={styles.container}>
        <StatusBar style="light" />
        {!logic.profile && !logic.isAdminAuthenticated ? (
          showSetup ? (
            <SetupScreen onComplete={logic.handleRegister} onBack={() => setShowSetup(false)} />
          ) : (
            <LoginScreen 
              staffList={staffList}
              onLogin={logic.handleLogin} 
              onAdminLogin={logic.handleAdminMasterLogin}
              onGoToSetup={() => setShowSetup(true)} 
            />
          )
        ) : (logic.profile?.isApproved === false && !logic.isAdminAuthenticated) ? (
          <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
            <View style={{ width: '100%', alignItems: 'center' }}>
              <ThemeCard style={{ padding: 40, width: '100%', alignItems: 'center', borderRadius: 32 }}>
                <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.1)', padding: 24, borderRadius: 100, marginBottom: 24 }}>
                  <Shield size={48} color={COLORS.primary} />
                </View>
                <ThemeText variant="h1" style={{ marginBottom: 12, textAlign: 'center' }}>登録承認待ち</ThemeText>
                <ThemeText variant="body" color={COLORS.textSecondary} style={{ textAlign: 'center', lineHeight: 24, marginBottom: 32 }}>
                   {logic.profile?.name} さんの登録申請を送信しました。{"\n"}
                   管理者が承認するまでお待ちください。
                </ThemeText>
                
                <TouchableOpacity 
                   style={styles.refreshBtn}
                   disabled={logic.isSyncing}
                   onPress={() => logic.handleForceCloudSync()}
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
                  { id: 'admin', icon: (logic.profile?.role?.includes('管理者') || logic.profile?.role?.includes('開発者')) ? Shield : User, label: (logic.profile?.role?.includes('管理者') || logic.profile?.role?.includes('開発者')) ? '管理・設定' : '設定' }
                ].map(tab => (
                  <TouchableOpacity key={tab.id} style={styles.tabItem} onPress={() => logic.setCurrentTab(tab.id)} activeOpacity={0.7}>
                    <tab.icon size={24} color={logic.currentTab === tab.id ? COLORS.primary : COLORS.textSecondary} />
                    <ThemeText variant="caption" style={{ marginTop: 4, fontSize: 9, color: logic.currentTab === tab.id ? COLORS.primary : COLORS.textSecondary }}>{tab.label}</ThemeText>
                  </TouchableOpacity>
                ))}
              </View>
            </SafeAreaView>
          </>
        )}
      </View>
      </ErrorBoundary>
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
