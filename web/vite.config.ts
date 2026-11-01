import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const api = process.env.API ?? "http://127.0.0.1:8100";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // src/main.tsx 里注册，新版 SW 接管后自动刷新一次
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "账本",
        short_name: "账本",
        lang: "zh-CN",
        start_url: "/",
        display: "standalone",
        background_color: "#F5F6F8",
        theme_color: "#F5F6F8",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        // 新版 SW 装好就接管。injectRegister 为 false 时插件不会自动打开这两项
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/api\//, /^\/logos\//],
        runtimeCaching: [
          // 账本数据先走网络，离线或连不上服务器时用上次的结果。超时留宽些：NAS 上账本改过后第一次重载可能要几秒
          { urlPattern: /\/api\//, handler: "NetworkFirst", options: { cacheName: "api", networkTimeoutSeconds: 10 } },
          // logo 先用缓存里的，同时去服务器取新的，图换了下次打开就是新的
          { urlPattern: /\/logos\//, handler: "StaleWhileRevalidate", options: { cacheName: "logos" } },
        ],
      },
    }),
  ],
  server: {
    host: true,
    proxy: { "/api": api, "/logos": api },
  },
});
