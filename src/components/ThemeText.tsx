import React from 'react';
import { Text, TextStyle, StyleSheet, StyleProp } from 'react-native';
import { COLORS } from '../theme/theme';

interface TextProps {
  children: React.ReactNode;
  variant?: 'h1' | 'h2' | 'body' | 'caption' | 'label';
  style?: StyleProp<TextStyle>;
  color?: string;
  bold?: boolean;
  numberOfLines?: number;
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
}

export const ThemeText: React.FC<TextProps> = ({ 
  children, 
  variant = 'body', 
  style, 
  color = COLORS.text,
  bold = false,
  numberOfLines,
  ellipsizeMode,
  adjustsFontSizeToFit = false,
  minimumFontScale = 0.8
}) => {
  const getVariantStyle = () => {
    switch (variant) {
      case 'h1': return styles.h1;
      case 'h2': return styles.h2;
      case 'caption': return styles.caption;
      case 'label': return styles.label;
      default: return styles.body;
    }
  };

  return (
    <Text 
      style={[
        getVariantStyle(), 
        { color }, 
        bold && styles.bold,
        style
      ]}
      numberOfLines={numberOfLines}
      ellipsizeMode={ellipsizeMode}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
    >
      {children}
    </Text>
  );
};

const styles = StyleSheet.create({
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24 },
  caption: { fontSize: 14, color: COLORS.textSecondary },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  bold: { fontWeight: '700' },
});
