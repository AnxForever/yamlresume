import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vitest/config'

import { baseConfig } from '../../vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      environment: 'jsdom',
      // Fills the browser APIs jsdom omits; see the file for what and why.
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  })
)
