import { defineConfig } from 'vite-plus';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/cli.ts',
      formats: ['es'],
      fileName: 'cli',
    },
    rollupOptions: {
      external: [/^node:/, 'react', 'ink', 'xstate', 'cac', 'zod'],
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
  lint: {
    ignorePatterns: ['dist/**', '.runs/**', 'node_modules/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: true,
    singleQuote: true,
  },
});
