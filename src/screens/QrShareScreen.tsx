import React from 'react';
import { StyleSheet, View, SafeAreaView, TouchableOpacity, ScrollView, Dimensions, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { ChevronLeft, Share2, Info } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';

import { APP_CONFIG } from '../constants/Config';

interface QrShareScreenProps {
  onBack: () => void;
  webUrl?: string;
}

const { width } = Dimensions.get('window');

export const QrShareScreen: React.FC<QrShareScreenProps> = ({ 
  onBack, 
  webUrl
}) => {
  const defaultWebUrl = APP_CONFIG.WEB_URL;
  const finalWebUrl = webUrl || defaultWebUrl;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <ChevronLeft color={COLORS.text} size={24} />
        </TouchableOpacity>
        <ThemeText variant="h1">共有・配布設定</ThemeText>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.heroSection}>
          <View style={styles.iconBadge}>
            <Share2 color="#38bdf8" size={32} />
          </View>
          <ThemeText variant="h1" style={styles.heroTitle}>スタッフに共有</ThemeText>
          <ThemeText variant="body" style={styles.heroSubtitle}>
            このQRコードをスタッフに読み取ってもらうことで、アプリを即座に導入できます。
          </ThemeText>
        </View>

        <ThemeCard style={styles.qrCard}>
          <View style={styles.qrOuterRing}>
            <View style={styles.qrBackground}>
              <QRCode
                value={finalWebUrl}
                size={width * 0.40}
                color="#0f172a"
                backgroundColor="white"
                quietZone={10}
              />
            </View>
          </View>

          <View style={styles.urlContainer}>
            <ThemeText variant="caption" color={COLORS.textSecondary} style={styles.urlLabel}>
              アクセスURL
            </ThemeText>
            <ThemeText variant="body" bold style={styles.urlText}>
              {finalWebUrl.replace('https://', '')}
            </ThemeText>
          </View>
        </ThemeCard>

        <View style={styles.infoBox}>
          <View style={styles.infoIcon}>
            <Info size={20} color="#38bdf8" />
          </View>
          <View style={{ flex: 1 }}>
            <ThemeText variant="body" bold style={{ color: '#38bdf8', marginBottom: 4 }}>
              インストールのコツ
            </ThemeText>
            <ThemeText variant="caption" color={COLORS.textSecondary}>
              SafariやChromeの「ホーム画面に追加」機能を使うことで、通常のアプリのようにアイコン化して利用できます。
            </ThemeText>
          </View>
        </View>
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: SPACING.md, 
    marginTop: Platform.OS === 'android' ? 30 : 0
  },
  backBtn: { 
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    justifyContent: 'center', 
    alignItems: 'center',
    marginRight: 16 
  },
  scroll: { flex: 1 },
  content: { padding: SPACING.md, gap: 24 },
  heroSection: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
    paddingHorizontal: 20,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    textAlign: 'center',
    fontSize: 28,
    marginBottom: 8,
  },
  heroSubtitle: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  qrCard: { 
    padding: 30, 
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  qrOuterRing: {
    padding: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 24,
  },
  qrBackground: { 
    padding: 16, 
    backgroundColor: 'white', 
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  urlContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  urlLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  urlText: { 
    fontSize: 14,
    color: '#38bdf8',
  },
  infoBox: { 
    flexDirection: 'row', 
    backgroundColor: 'rgba(56, 189, 248, 0.05)', 
    padding: 20, 
    borderRadius: 20, 
    alignItems: 'flex-start',
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.1)',
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
