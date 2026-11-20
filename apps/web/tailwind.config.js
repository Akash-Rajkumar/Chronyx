/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0B1220',
        card: '#121A2E',
        border: '#1F2B4A',
        foreground: '#E8EEFF',
        muted: '#9FB0D6',
        accent: {
          cyan: '#3DD6F5',
        },
        trust: {
          trusted: '#3DDC97',
          suspect: '#F5A524',
          quarantined: '#FF5C5C',
          recovering: '#6EA8FF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '12px',
        lg: '12px',
        xl: '16px',
      },
    },
  },
  plugins: [],
};

