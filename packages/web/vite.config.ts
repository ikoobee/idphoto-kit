import { defineConfig } from "vite"

export default defineConfig({
  // workspace package sources are consumed as plain TS via the workspace: link
  optimizeDeps: {
    exclude: ["@idphoto-kit/core", "@idphoto-kit/specs"],
  },
  build: {
    target: "es2022",
  },
})
