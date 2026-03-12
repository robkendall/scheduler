import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ["robkendall.duckdns.org"],
    port: 5174,
    proxy: {
      "/api": {
        target: "http://api:3002",
        changeOrigin: true
      }
    }
  }
})