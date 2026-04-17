import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, Platform } from 'react-native';
import { ThemeText } from './ThemeText';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { AlertTriangle, RefreshCcw, ShieldAlert } from 'lucide-react-native';

const reloadApp = () => {
  if (Platform.OS === 'web') {
    window.location.reload();
  } else {
    // For Native, we can't easily reload without expo-updates.
    // We'll just reset the state and hope for the best, or suggest manual restart.
    return false;
  }
  return true;
};

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReload = () => {
    const success = reloadApp();
    if (!success) {
      this.setState({ hasError: false, error: null });
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.iconContainer}>
              <ShieldAlert size={80} color="#ef4444" />
            </View>
            
            <ThemeText variant="h1" style={styles.title}>
              致命的な問題が発生しました
            </ThemeText>
            
            <ThemeText variant="body" style={styles.message}>
              アプリケーションの一部でエラーが発生し、動作を継続できなくなりました。以下の情報が開発の助けになります。
            </ThemeText>

            <View style={styles.errorCard}>
              <View style={styles.errorHeader}>
                <AlertTriangle size={16} color="#ef4444" />
                <ThemeText bold color="#ef4444" style={{ marginLeft: 8 }}>Error Message</ThemeText>
              </View>
              <ThemeText variant="caption" color={COLORS.textSecondary} style={styles.errorText}>
                {this.state.error?.message || 'Unknown Error'}
              </ThemeText>
            </View>

            <View style={styles.actionContainer}>
              <TouchableOpacity style={styles.reloadButton} onPress={this.handleReload}>
                <RefreshCcw size={20} color="white" />
                <ThemeText bold color="white" style={{ marginLeft: 10 }}>アプリを再起動する</ThemeText>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.retryButton} 
                onPress={() => this.setState({ hasError: false, error: null })}
              >
                <ThemeText variant="caption" color={COLORS.textSecondary}>
                  エラーを無視して再試行（非推奨）
                </ThemeText>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      );
    }

    return this.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100%',
  },
  iconContainer: {
    marginBottom: 24,
    padding: 24,
    borderRadius: 100,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  title: {
    textAlign: 'center',
    marginBottom: 16,
  },
  message: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    marginBottom: 32,
    lineHeight: 22,
  },
  errorCard: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    marginBottom: 40,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  errorText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actionContainer: {
    width: '100%',
    gap: 16,
  },
  reloadButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 16,
    width: '100%',
  },
  retryButton: {
    alignItems: 'center',
    padding: 12,
  },
});
