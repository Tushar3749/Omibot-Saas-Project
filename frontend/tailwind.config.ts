import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // W3Schools Green palette
        primary: {
          50:  '#E8F5E9',
          100: '#C8E6C9',
          200: '#A5D6A7',
          300: '#81C784',
          400: '#66BB6A',
          500: '#4CAF50',
          600: '#04AA6D',   // W3Schools accent green (buttons)
          700: '#388E3C',   // dark green
          800: '#2E7D32',
          900: '#1B5E20',
        },
        // W3Schools dark header/sidebar
        w3dark: '#282A35',
        w3mid:  '#3d3f4e',   // slightly lighter, for borders on dark
        // Surface tokens
        surface: '#F9F9F9',
        sidebar: '#282A35',  // DARK sidebar
        brand:   '#04AA6D',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm:  '2px',
        md:  '4px',
        lg:  '6px',
        xl:  '8px',
        '2xl': '12px',
        '3xl': '16px',
      },
      boxShadow: {
        'sm':   '0 1px 2px 0 rgba(0,0,0,0.06)',
        'card': '0 1px 3px 0 rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
        'md':   '0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.04)',
        'lg':   '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04)',
        'glow': '0 0 0 3px rgba(4,170,109,0.15)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
export default config
