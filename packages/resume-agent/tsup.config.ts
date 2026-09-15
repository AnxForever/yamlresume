import { defineConfig } from 'tsup'

import { baseConfig } from '../../tsup.config.base'

export default defineConfig({
  ...baseConfig,
  dts: true,
  entry: ['src/index.ts'],
  tsconfig: 'tsconfig.build.json',
})
