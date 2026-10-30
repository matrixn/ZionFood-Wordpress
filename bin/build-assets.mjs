import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('assets/dist', { recursive: true });
await build({
    entryPoints: {
        admin: 'assets/src/admin.js',
        public: 'assets/src/public.js',
        blocks: 'assets/src/blocks.js',
    },
    outdir: 'assets/dist',
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2021'],
    loader: { '.png': 'dataurl', '.svg': 'dataurl' },
    legalComments: 'external',
    logLevel: 'info',
});
await copyFile('node_modules/leaflet/LICENSE', 'assets/dist/LEAFLET-LICENSE');
