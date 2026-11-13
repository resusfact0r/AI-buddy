import type { Config } from 'tailwindcss';

/**
 * Токены в стилистике Авито: чёрный текст, белые поверхности на тёплом сером фоне,
 * яркие акценты (голубой, зелёный, фиолетовый, красный) и их пастельные пары для плашек.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Manrope Variable"', 'Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        ink: { DEFAULT: '#0A0A0A', soft: '#5E6673', muted: '#757C86' },
        canvas: '#F2F1F0',
        line: '#E3E2E0',
        brand: { DEFAULT: '#00AAFF', soft: '#BADAFB', strong: '#0072C6' },
        ok: { DEFAULT: '#04E061', soft: '#C9FFBF', strong: '#00792F' },
        warn: { DEFAULT: '#FFB021', soft: '#FFE8A6', strong: '#7A4D00' },
        danger: { DEFAULT: '#FF4053', soft: '#F7C1C5', strong: '#B80F24' },
        violet: { DEFAULT: '#965EEB', soft: '#DFCDF3', strong: '#5A2BB3' },
      },
      borderRadius: { xl: '12px', '2xl': '16px', '3xl': '24px' },
      boxShadow: {
        card: '0 0 0 1px rgba(10,10,10,.04)',
        pop: '0 12px 40px rgba(10,10,10,.16)',
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
