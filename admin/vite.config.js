import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Tell Vite to look in root node_modules for all packages
    preserveSymlinks: true,
    alias: {
      // Explicit aliases for direct imports
      '@tiptap/react': path.resolve(__dirname, '../node_modules/@tiptap/react'),
      '@tiptap/starter-kit': path.resolve(__dirname, '../node_modules/@tiptap/starter-kit'),
      '@tiptap/extension-link': path.resolve(__dirname, '../node_modules/@tiptap/extension-link'),
      '@tiptap/extension-placeholder': path.resolve(__dirname, '../node_modules/@tiptap/extension-placeholder'),
      '@tiptap/extension-text-align': path.resolve(__dirname, '../node_modules/@tiptap/extension-text-align'),
      '@tiptap/extension-underline': path.resolve(__dirname, '../node_modules/@tiptap/extension-underline'),
      // Add core dependencies that TipTap needs
      '@tiptap/core': path.resolve(__dirname, '../node_modules/@tiptap/core'),
      '@tiptap/pm': path.resolve(__dirname, '../node_modules/@tiptap/pm'),
      '@floating-ui/dom': path.resolve(__dirname, '../node_modules/@floating-ui/dom'),
      '@floating-ui/core': path.resolve(__dirname, '../node_modules/@floating-ui/core'),
    },
  },
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Tell Rollup to look in parent node_modules
    rollupOptions: {
      external: [],
    }
  }
});
