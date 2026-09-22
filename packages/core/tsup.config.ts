import { defineConfig } from 'tsup'

import { baseConfig } from '../../tsup.config.base'

export default defineConfig({
  ...baseConfig,
  dts: true,
  tsconfig: 'tsconfig.prod.json',
  // `src/schema` is a second entry point so browser consumers can validate a
  // resume without pulling the compiler/renderer barrel (and with it
  // js-beautify, remark and the LaTeX codegen) into their bundle.
  entry: ['src/index.ts', 'src/schema/index.ts'],
  loader: {
    '.css': 'text',
  },
})
