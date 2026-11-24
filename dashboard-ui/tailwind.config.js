/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slateBg: '#0B0F19',
        cardSurface: '#111827',
        cardBorder: '#1F2937',
        textPrimary: '#F9FAFB',
        textMuted: '#9CA3AF',
        statusPass: '#10B981',
        statusWarn: '#F59E0B',
        statusErr: '#EF4444',
        metricCyan: '#06B6D4',
        metricIndigo: '#6366F1',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
