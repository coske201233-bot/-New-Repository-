import { Platform } from 'react-native';

/**
 * 現在のデバイスが「保存・同期権限を持つモバイル端末」であるかどうかを判定します。
 * PCブラウザ版を読み取り専用にするために使用します。
 */
export const isMobileDevice = (): boolean => {
  // ユーザーがWeb版をメインで利用するように変更されたため、すべてのデバイスで同期を許可する
  return true;

};
