import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        test: {
          name: 'worker',
          environment: 'node',
          include: ['tests/worker/**/*.test.ts', 'tests/shared/**/*.test.ts', 'tests/repo/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['tests/app/**/*.test.tsx'],
        },
      },
    ],
  },
});
