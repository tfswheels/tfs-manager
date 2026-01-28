import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@tiptap/react': path.resolve(__dirname, '../node_modules/@tiptap/react'),
      '@tiptap/starter-kit': path.resolve(__dirname, '../node_modules/@tiptap/starter-kit'),
      '@tiptap/extension-link': path.resolve(__dirname, '../node_modules/@tiptap/extension-link'),
      '@tiptap/extension-placeholder': path.resolve(__dirname, '../node_modules/@tiptap/extension-placeholder'),
      '@tiptap/extension-text-align': path.resolve(__dirname, '../node_modules/@tiptap/extension-text-align'),
      '@tiptap/extension-underline': path.resolve(__dirname, '../node_modules/@tiptap/extension-underline'),
    },
  },
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
