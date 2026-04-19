import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, Platform, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('--- [CRITICAL UI CRASH] ---');
    console.error(error);
    console.error(errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = async () => {
    try {
      console.log('Emergency Reset: Clearing all storage...');
      await AsyncStorage.clear();
      if (Platform.OS === 'web') {
        window.location.href = window.location.origin; // 強制リロード
      }
    } catch (e) {
      console.error('Reset failed:', e);
    }
  };

  private handleReload = () => {
    if (Platform.OS === 'web') {
      window.location.reload();
    } else {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <Text style={styles.icon}>💀</Text>
              <Text style={styles.title}>アプリケーションが停止しました</Text>
              <Text style={styles.subtitle}>
                致命的なエラーをキャッチしました。以下の情報が解決のヒントになります。
              </Text>
            </View>

            <View style={styles.errorCard}>
              <Text style={styles.errorLabel}>ERROR MESSAGE:</Text>
              <Text style={styles.errorText}>
                {this.state.error?.toString() || 'Unknown Error'}
              </Text>
              
              <Text style={[styles.errorLabel, { marginTop: 15 }]}>STACK TRACE:</Text>
              <ScrollView style={styles.stackBox}>
                <Text style={styles.stackText}>
                  {this.state.errorInfo?.componentStack || 'No stack trace available'}
                </Text>
              </ScrollView>
            </View>

            <View style={styles.actionContainer}>
              <TouchableOpacity style={styles.reloadButton} onPress={this.handleReload}>
                <Text style={styles.buttonText}>再読み込みを試行</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.resetButton} onPress={this.handleReset}>
                <Text style={styles.buttonText}>アプリを初期化して再起動 (推奨)</Text>
              </TouchableOpacity>
              
              <Text style={styles.hint}>
                ※「初期化」を行うと、保存されていないデータや設定が消去されますが、
                起動できない問題はほぼ確実に解決します。
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  icon: {
    fontSize: 60,
    marginBottom: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
  errorCard: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 30,
  },
  errorLabel: {
    color: '#ff4444',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  errorText: {
    color: '#eee',
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  stackBox: {
    maxHeight: 150,
    backgroundColor: '#000',
    borderRadius: 6,
    padding: 10,
  },
  stackText: {
    color: '#666',
    fontSize: 11,
    lineHeight: 16,
  },
  actionContainer: {
    width: '100%',
    gap: 15,
  },
  reloadButton: {
    backgroundColor: '#333',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  resetButton: {
    backgroundColor: '#ff4444',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  hint: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 16,
  },
});
