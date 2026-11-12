import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Manrope Variable"', 'Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        ink: { DEFAULT: '#1A1A1A', soft: '#5C5C5C', muted: '#8F8F8F' },
        canvas: '#F2F3F5',
        line: '#E4E5E8',
        brand: { DEFAULT: '#0099F7', soft: '#E5F4FF', strong: '#007ACC' },
        ok: { DEFAULT: '#02A35C', soft: '#E3F7EC' },
        warn: { DEFAULT: '#E58A00', soft: '#FFF3DE' },
        danger: { DEFAULT: '#E5334B', soft: '#FDE8EB' },
        violet: { DEFAULT: '#965EEB', soft: '#F1E9FD' },
      },
      borderRadius: { xl: '14px', '2xl': '20px', '3xl': '28px' },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 2px 8px rgba(16,24,40,.04)',
        pop: '0 8px 32px rgba(16,24,40,.14)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        pulse3: { '0%,80%,100%': { opacity: '.25' }, '40%': { opacity: '1' } },
      },
      animation: { 'fade-up': 'fade-up .25s ease-out both' },
    },
  },
  plugins: [],
} satisfies Config;
