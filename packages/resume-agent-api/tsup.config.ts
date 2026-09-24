import { defineConfig } from 'tsup'

import { baseConfig } from '../../tsup.config.base'

export default defineConfig({
  ...baseConfig,
  dts: true,
  entry: ['src/local-data.ts', 'src/server.ts'],
  tsconfig: 'tsconfig.build.json',
})
