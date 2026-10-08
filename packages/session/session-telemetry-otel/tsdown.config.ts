import {defineConfig} from 'tsdown'

/** Build independent Session backend, invariant and shared SDK pipeline entries. */
export default defineConfig({entry: ['lib/types/index.js','lib/types/invariant.js','lib/types/pipeline.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false})
