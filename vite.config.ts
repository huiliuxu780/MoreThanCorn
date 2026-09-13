import fs from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  /* 09-13 审计修复（eng#17）：vendor 分组拆包——原 802kB「tool-result」共享块
     （syntax-highlighter/motion/radix 混入动态导入命名块）与 487kB 入口块拆散，
     重依赖按组独立缓存，路由懒加载不再拖全量 vendor */
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id))
            return "vendor-react"
          if (id.includes("@radix-ui")) return "vendor-radix"
          if (/[\\/](@codemirror|@lezer|@uiw|codemirror|style-mod|w3c-keyname|crelt)[\\/]/.test(id))
            return "vendor-codemirror"
          if (/[\\/](react-syntax-highlighter|refractor|highlight\.js|lowlight|prismjs|react-markdown|remark-gfm|mdast|micromark|hast|unist|unified|bail|trough|vfile)[\\/]/.test(id))
            return "vendor-markdown"
          if (/[\\/](recharts|d3-[^\\/]+|victory-vendor|internmap)[\\/]/.test(id))
            return "vendor-charts"
          if (id.includes("@xyflow")) return "vendor-flow"
          if (/[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id))
            return "vendor-motion"
          /* 其余依赖不设 catch-all：强分组会与命名组形成循环 chunk
             （rollup 实测警告），交给 rollup 按引用图自然放置 */
          return undefined
        },
      },
    },
  },
  test: {
    setupFiles: ["./src/test-setup.ts"],
  },
  define: {
    /* 设置页「系统信息」展示真实版本号 */
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
