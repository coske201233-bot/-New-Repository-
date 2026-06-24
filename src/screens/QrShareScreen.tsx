import React, { useRef } from 'react';
import { StyleSheet, View, SafeAreaView, TouchableOpacity, ScrollView, Dimensions, Platform, Share, Alert, Clipboard } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { ChevronLeft, Share2, Info, Copy, MessageCircle, Download } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

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
  const svgRef = useRef<any>(null);

  // URLをクリップボードにコピーする関数
  const handleCopyUrl = async () => {
    try {
      if (Platform.OS === 'web') {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(finalWebUrl);
          Alert.alert('コピー完了', 'URLをクリップボードにコピーしました。');
        } else {
          Alert.alert('エラー', 'このブラウザはコピーをサポートしていません。');
        }
      } else {
        Clipboard.setString(finalWebUrl);
        Alert.alert('コピー完了', 'URLをクリップボードにコピーしました。');
      }
    } catch (error) {
      Alert.alert('エラー', 'コピーに失敗しました。');
    }
  };

  // URLをLINEや他のアプリで共有する関数
  const handleShareUrl = async () => {
    try {
      await Share.share({
        message: `スタッフ用シフト管理アプリの共有URLはこちらです：\n${finalWebUrl}`,
        url: finalWebUrl,
      });
    } catch (error: any) {
      Alert.alert('エラー', '共有に失敗しました。');
    }
  };

  // QRコード画像を共有・保存する関数
  const handleShareImage = () => {
    if (!svgRef.current) {
      Alert.alert('エラー', 'QRコードの読み込みが完了していません。');
      return;
    }
    
    svgRef.current.toDataURL(async (dataURL: string) => {
      if (Platform.OS === 'web') {
        try {
          const link = document.createElement('a');
          link.href = `data:image/png;base64,${dataURL}`;
          link.download = 'staff_app_qrcode.png';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (error) {
          Alert.alert('エラー', '画像のダウンロードに失敗しました。');
        }
      } else {
        try {
          // キャッシュディレクトリに一時保存
          const filename = `${FileSystem.cacheDirectory}staff_qrcode.png`;
          await FileSystem.writeAsStringAsync(filename, dataURL, {
            encoding: FileSystem.EncodingType.Base64,
          });
          
          // 共有ダイアログを表示
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(filename, {
              mimeType: 'image/png',
              dialogTitle: 'QRコード画像を共有',
            });
          } else {
            Alert.alert('エラー', 'この端末ではファイル共有がサポートされていません。');
          }
        } catch (error) {
          console.error('Error sharing image:', error);
          Alert.alert('エラー', '画像の共有に失敗しました。');
        }
      }
    });
  };

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
            このQRコードをスタッフに読み取ってもらうか、LINE等で共有してアプリを導入してもらいましょう。
          </ThemeText>
        </View>

        <ThemeCard style={styles.qrCard}>
          <View style={styles.qrOuterRing}>
            <View style={styles.qrBackground}>
              <QRCode
                value={finalWebUrl}
                size={250}
                color="#0f172a"
                backgroundColor="white"
                quietZone={10}
                getRef={(c) => (svgRef.current = c)}
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

        {/* 共有アクションボタンエリア */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity 
            style={[styles.actionButton, styles.primaryButton]} 
            onPress={handleShareUrl}
            activeOpacity={0.8}
          >
            <MessageCircle size={20} color="#ffffff" style={styles.buttonIcon} />
            <ThemeText style={styles.primaryButtonText} bold>
              URLをLINE等で送る
            </ThemeText>
          </TouchableOpacity>

          <View style={styles.secondaryActions}>
            <TouchableOpacity 
              style={[styles.actionButton, styles.secondaryButton]} 
              onPress={handleShareImage}
              activeOpacity={0.8}
            >
              <Download size={18} color="#38bdf8" style={styles.buttonIcon} />
              <ThemeText style={styles.secondaryButtonText} bold>
                {Platform.OS === 'web' ? 'QRコードを保存' : 'QRコードを共有'}
              </ThemeText>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.actionButton, styles.secondaryButton]} 
              onPress={handleCopyUrl}
              activeOpacity={0.8}
            >
              <Copy size={18} color="#38bdf8" style={styles.buttonIcon} />
              <ThemeText style={styles.secondaryButtonText} bold>
                URLをコピー
              </ThemeText>
            </TouchableOpacity>
          </View>
        </View>

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
  actionsContainer: {
    gap: 12,
    width: '100%',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  primaryButton: {
    backgroundColor: '#0ea5e9',
    borderColor: '#0ea5e9',
    width: '100%',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'rgba(56, 189, 248, 0.05)',
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  secondaryButtonText: {
    color: '#38bdf8',
    fontSize: 14,
  },
  buttonIcon: {
    marginRight: 8,
  },
});
