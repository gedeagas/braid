import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['src/main/**/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'shared',
          include: ['src/shared/**/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: { '@': resolve(__dirname, 'src/renderer') },
        },
        define: {
          // Force React's development build so React.act is available in tests.
          'process.env.NODE_ENV': JSON.stringify('test'),
        },
        test: {
          name: 'renderer',
          include: ['src/renderer/**/__tests__/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['src/renderer/__tests__/setup.ts'],
        },
      },
    ],
  },
})
