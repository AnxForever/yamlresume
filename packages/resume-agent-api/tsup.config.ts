import { defineConfig } from 'tsup'

import { baseConfig } from '../../tsup.config.base'

export default defineConfig({
  ...baseConfig,
  dts: true,
  entry: ['src/server.ts'],
  tsconfig: 'tsconfig.build.json',
})
