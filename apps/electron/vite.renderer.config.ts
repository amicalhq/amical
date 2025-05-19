import * as vite from 'vite';
import { resolve } from 'path';
// https://vitejs.dev/config
export default vite.defineConfig(async () => {
  // @ts-ignore
  const { default: tailwindcss } = await import('@tailwindcss/vite');

  return {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    optimizeDeps: {
      exclude: ['better-sqlite3'],
    },
  };
});
