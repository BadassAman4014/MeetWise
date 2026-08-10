/* eslint-disable no-undef */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleSummarize, handleChat } from './server/gemini.js'
import { handleNvidiaSummarize, handleNvidiaChat } from './server/nvidia.js'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  process.env.GEMINI_API_KEY ||= env.GEMINI_API_KEY
  process.env.NVIDIA_API_KEY ||= env.NVIDIA_API_KEY

  return {
    plugins: [
      react(),
      {
        name: 'meetwise-api',
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            const pathname = request.url?.split('?')[0]
            if (pathname === '/api/chat/nvidia') return await handleNvidiaChat(request, response)
            if (pathname === '/api/chat') return await handleChat(request, response)
            if (pathname === '/api/summarize/nvidia') return await handleNvidiaSummarize(request, response)
            if (pathname === '/api/summarize') return await handleSummarize(request, response)
            next()
          })
        },
      },
    ],
    worker: { format: 'es' },
  }
})
