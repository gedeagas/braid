import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty'],
        input: {
          index: resolve('src/main/index.ts'),
          agentProcess: resolve('src/main/services/agentProcess.ts'),
          acpProcess: resolve('src/main/services/acpProcess.ts')
        },
        output: {
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'zustand'],
            'vendor-monaco': ['@monaco-editor/react'],
            'vendor-tiptap': [
              '@tiptap/react',
              '@tiptap/core',
              '@tiptap/starter-kit',
              'tiptap-markdown'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit'],
            'vendor-markdown': ['react-markdown', 'remark-gfm', 'rehype-highlight']
          }
        }
      }
    }
  }
})
