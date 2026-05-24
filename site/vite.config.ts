import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';

export default defineConfig({
  plugins: [
    {
      // MDX must run before @vitejs/plugin-react so JSX in .mdx files gets HMR via Fast Refresh.
      enforce: 'pre',
      ...mdx({ providerImportSource: '@mdx-js/react' }),
    },
    react({ include: /\.(jsx|tsx|mdx)$/ }),
  ],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
