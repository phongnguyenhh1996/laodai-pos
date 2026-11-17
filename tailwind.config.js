/** @type {import('tailwindcss').Config} */

/** Màu ngữ nghĩa lấy từ biến CSS (src/index.css) ⇒ đổi bảng màu chỉ cần sửa một chỗ. Xem design-system/laodai-pos/MASTER.md. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Be Vietnam Pro"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      colors: {
        canvas: token('canvas'),
        surface: {
          DEFAULT: token('surface'),
          muted: token('surface-muted'),
          sunken: token('surface-sunken'),
        },
        line: {
          DEFAULT: token('line'),
          strong: token('line-strong'),
        },
        ink: {
          DEFAULT: token('ink'),
          muted: token('ink-muted'),
          subtle: token('ink-subtle'),
        },
        brand: {
          DEFAULT: token('brand'),
          strong: token('brand-strong'),
          deep: token('brand-deep'),
          soft: token('brand-soft'),
          line: token('brand-line'),
        },
        success: {
          DEFAULT: token('success'),
          strong: token('success-strong'),
          soft: token('success-soft'),
          line: token('success-line'),
        },
        warning: {
          DEFAULT: token('warning'),
          strong: token('warning-strong'),
          soft: token('warning-soft'),
          line: token('warning-line'),
        },
        danger: {
          DEFAULT: token('danger'),
          strong: token('danger-strong'),
          soft: token('danger-soft'),
          line: token('danger-line'),
        },
        info: {
          DEFAULT: token('info'),
          soft: token('info-soft'),
          line: token('info-line'),
        },
      },
      minHeight: { tap: '56px' },
      minWidth: { tap: '56px' },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.05)',
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        raised: '0 10px 30px -8px rgb(15 23 42 / 0.25), 0 4px 10px -4px rgb(15 23 42 / 0.10)',
      },
      transitionDuration: { fast: '150ms' },
    },
  },
  plugins: [],
};
