export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: { 950: '#071A17', 900: '#0B2420', 800: '#10362F', 700: '#164940' },
        eco: { 500: '#1F8A70', 400: '#4CC38A', 200: '#B7F7D0' },
        risk: { low: '#7E9C8E', moderate: '#4CC38A', high: '#F3B44E', critical: '#E35D5D' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(76 195 138 / 0.12), 0 16px 56px rgb(0 0 0 / 0.22)',
      },
    },
  },
  plugins: [],
};
