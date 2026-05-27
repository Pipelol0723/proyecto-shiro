import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      // Config files at root run in Node directly, no need for type-aware linting.
      'eslint.config.js',
      'vitest.config.ts',
      'vitest.workspace.ts',
      '**/*.config.js',
      '**/*.config.ts',
      // Bundle del diseño exportado por Claude Design — referencia, no codigo.
      'docs/design-mockup/**',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        // projectService autodetecta el tsconfig.json más cercano,
        // útil en monorepo para que cada paquete use su propio tsconfig.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // React-specific rules para archivos .tsx
  {
    files: ['**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-refresh: avisa si exportas algo que no sea componente
      // desde un archivo con componentes (rompe HMR de Vite).
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['**/tests/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      // En tests usamos expect(mock.fn) que ESLint detecta como unbound
      // method, pero es el patrón canónico de assertions con Vitest.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  prettierConfig,
);
