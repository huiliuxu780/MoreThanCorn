import fs from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

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
  define: {
    /* 设置页「系统信息」展示真实版本号 */
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
