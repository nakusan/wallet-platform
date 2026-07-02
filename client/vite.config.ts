import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 让前端直接请求 /v1/*，由 dev server 转发到 aggregator
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
