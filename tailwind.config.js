/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      minHeight: { tap: '56px' },
      minWidth: { tap: '56px' },
    },
  },
  plugins: [],
};
