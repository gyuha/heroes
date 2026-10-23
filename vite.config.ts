import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // three.js 단독으로 약 550KB(gzip 140KB)라 기본 한도(500KB)를 넘는다. 코드 분할은 필요해지면 한다.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
