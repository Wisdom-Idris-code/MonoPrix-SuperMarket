/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          red: '#D71920',
          charcoal: '#171717',
          warm: '#F7F5F2',
          stone: '#ECEAE7',
          yellow: '#F2B544'
        }
      },
      boxShadow: {
        soft: '0 10px 25px rgba(23, 23, 23, 0.08)'
      }
    },
  },
  plugins: [],
};
