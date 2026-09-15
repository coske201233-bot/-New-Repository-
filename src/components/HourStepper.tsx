import React, { useCallback } from 'react';
import { StyleSheet, View, TouchableOpacity, Platform, ViewStyle } from 'react-native';
import { ThemeText } from './ThemeText';
import { COLORS } from '../theme/theme';

export interface HourStepperProps {
  value: number;
  onChange: (value: number | ((prev: number) => number)) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

export const HourStepper: React.FC<HourStepperProps> = React.memo(({
  value,
  onChange,
  step = 0.25,
  min = 0.25,
  max = 7.75,
  unit = 'h',
  disabled = false,
  style,
}) => {
  const handleDecrement = useCallback(() => {
    if (disabled) return;
    onChange((prev: number) => {
      const current = typeof prev === 'number' && !isNaN(prev) ? prev : min;
      const next = Math.round((current - step) * 100) / 100;
      return Math.max(min, Math.min(max, next));
    });
  }, [onChange, step, min, max, disabled]);

  const handleIncrement = useCallback(() => {
    if (disabled) return;
    onChange((prev: number) => {
      const current = typeof prev === 'number' && !isNaN(prev) ? prev : min;
      const next = Math.round((current + step) * 100) / 100;
      return Math.max(min, Math.min(max, next));
    });
  }, [onChange, step, min, max, disabled]);

  const isMin = value <= min;
  const isMax = value >= max;

  return (
    <View style={[styles.container, style]}>
      <TouchableOpacity
        onPress={handleDecrement}
        disabled={disabled || isMin}
        activeOpacity={0.6}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="時間を減らす"
        style={[
          styles.adjustBtn,
          (disabled || isMin) && styles.adjustBtnDisabled
        ]}
      >
        <ThemeText bold style={[styles.adjustBtnText, (disabled || isMin) && styles.textDisabled]}>
          -
        </ThemeText>
      </TouchableOpacity>

      <View style={styles.valueBox}>
        <ThemeText variant="h2" color={COLORS.primary} style={styles.valueText}>
          {value.toFixed(2)}{unit}
        </ThemeText>
      </View>

      <TouchableOpacity
        onPress={handleIncrement}
        disabled={disabled || isMax}
        activeOpacity={0.6}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="時間を増やす"
        style={[
          styles.adjustBtn,
          (disabled || isMax) && styles.adjustBtnDisabled
        ]}
      >
        <ThemeText bold style={[styles.adjustBtnText, (disabled || isMax) && styles.textDisabled]}>
          +
        </ThemeText>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  adjustBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      userSelect: 'none',
      outlineStyle: 'none',
    } as any : {}),
  },
  adjustBtnDisabled: {
    opacity: 0.35,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    ...(Platform.OS === 'web' ? {
      cursor: 'not-allowed',
    } as any : {}),
  },
  adjustBtnText: {
    fontSize: 22,
    color: '#38bdf8',
    lineHeight: 24,
  },
  textDisabled: {
    color: 'rgba(255, 255, 255, 0.3)',
  },
  valueBox: {
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: {
    ...(Platform.OS === 'web' ? {
      userSelect: 'none',
    } as any : {}),
  },
});
