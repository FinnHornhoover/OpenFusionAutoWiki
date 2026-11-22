import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';
import localProse from './dev/prose';

function localObjects(): Plugin {
  const serve: Connect.NextHandleFunction = (request, response, next) => {
    const match = /^\/objects\/v4\/((?:models\/(?:prefabs|geometry|buffers)|animations\/gltf|areas\/(?:tiles|terrain)|textures|audio\/(?:clips|banks))\/[a-f0-9]{64}\.(glb|bin|webp|png|ogg|json))(?:\?.*)?$/.exec(request.url ?? '');
    if (!match) return next();
    const file = resolve(__dirname, '../.cache/objects/pool', match[1]);
    if (!existsSync(file)) { response.statusCode = 404; response.end(); return; }
    response.setHeader('Content-Type', match[2] === 'ogg' ? 'audio/ogg' : match[2] === 'json' ? 'application/json' : match[2] === 'webp' ? 'image/webp' : match[2] === 'png' ? 'image/png' : match[2] === 'glb' ? 'model/gltf-binary' : 'application/octet-stream');
    createReadStream(file).on('error', () => { response.destroy(); }).pipe(response);
  };
  return {
    name: 'local-object-assets',
    configureServer: (server) => { server.middlewares.use(serve); },
    configurePreviewServer: (server) => { server.middlewares.use(serve); },
  };
}

export default defineConfig({
  plugins: [
    localObjects(),
    localProse(),
    {
      // MDX must run before @vitejs/plugin-react so JSX in .mdx files gets HMR via Fast Refresh.
      enforce: 'pre',
      ...mdx({ providerImportSource: '@mdx-js/react' }),
    },
    react({ include: /\.(jsx|tsx|mdx)$/ }),
  ],
  optimizeDeps: { include: ['ff-three/world'] },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
