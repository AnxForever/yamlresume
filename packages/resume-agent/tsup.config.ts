import { defineConfig } from 'tsup'

import { baseConfig } from '../../tsup.config.base'

export default defineConfig({
  ...baseConfig,
  dts: true,
  entry: ['src/index.ts'],
  // Optional peer: loaded lazily by the transformers embedding adapter and
  // never bundled, so the library stays small for consumers without it.
  external: ['@huggingface/transformers'],
  tsconfig: 'tsconfig.build.json',
})
