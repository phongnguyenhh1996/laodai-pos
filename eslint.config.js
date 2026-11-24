// Luật lint của dự án. Mỗi luật ở đây là một dòng trong docs/coding-standards.md đã được tự động hóa.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist', 'dev-dist', 'coverage', 'android', 'node_modules', '.figma-preview', 'design-system',
      'cypress/videos', 'cypress/screenshots', 'public', '**/*.tsbuildinfo',
      'scripts/figma-sync', // script chạy trong plugin Figma, không phải code app
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // coding-standards: "không dùng any"
      '@typescript-eslint/no-explicit-any': 'error',
      // tsc đã bắt biến không dùng (noUnusedLocals); cho phép tiền tố _ để bỏ qua có chủ ý
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // coding-standards (UI): mọi ô tiền dùng MoneyInput (nhập theo nghìn). Ô số tự gắn đuôi "đ" là ô tiền kiểu cũ.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name=/^(unit|suffix)$/] Literal[value='đ']",
          message: 'Ô tiền phải dùng MoneyInput (src/app/MoneyInput.tsx, nhập theo nghìn), không tự gắn đuôi "đ".',
        },
      ],
    },
  },
  {
    // Edge Function chạy trên Deno
    files: ['supabase/functions/**/*.ts'],
    languageOptions: { globals: { Deno: 'readonly' } },
  },
)
