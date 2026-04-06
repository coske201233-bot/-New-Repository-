import React from 'react';
import { StyleSheet, View, SafeAreaView, TouchableOpacity, ScrollView } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { ChevronLeft } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';

import { APP_CONFIG } from '../constants/Config';

interface QrShareScreenProps {
  onBack: () => void;
  webUrl?: string;
}

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
        <ThemeCard style={styles.qrCard}>
          <ThemeText variant="body" style={styles.instruction}>
            ブラウザで即座にアプリを開けます。各種端末での利用や、ホーム画面に追加して利用するのに最適です。
          </ThemeText>
          
          <View style={styles.qrContainer}>
            <QRCode
              value={finalWebUrl}
              size={220}
              color="white"
              backgroundColor="transparent"
            />
          </View>

          <ThemeText variant="caption" color={COLORS.textSecondary} style={styles.urlText}>
            {finalWebUrl}
          </ThemeText>
        </ThemeCard>

        <View style={styles.infoBox}>
          <ThemeText variant="caption" color={COLORS.textSecondary} style={{ flex: 1, textAlign: 'center' }}>
            Web版ではブラウザ（SafariやChrome）の「ホーム画面に追加」機能を使うことで、インストールしたアプリのようにご利用いただけます。
          </ThemeText>
        </View>
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
    marginTop: SPACING.md 
  },
  backBtn: { marginRight: 16 },
  scroll: { flex: 1 },
  content: { padding: SPACING.md, gap: 24, paddingBottom: 40 },
  qrCard: { padding: 24, alignItems: 'center' },
  instruction: { textAlign: 'center', marginBottom: 24, paddingHorizontal: 12 },
  qrContainer: { 
    padding: 16, 
    backgroundColor: '#1e293b', 
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10
  },
  urlText: { marginTop: 16, fontSize: 10 },
  infoBox: { 
    flexDirection: 'row', 
    backgroundColor: 'rgba(255,255,255,0.02)', 
    padding: 16, 
    borderRadius: 12, 
    alignItems: 'center' 
  },
});
