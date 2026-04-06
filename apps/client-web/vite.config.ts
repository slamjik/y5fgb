import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@project/shared-types": path.resolve(__dirname, "../../packages/shared-types/src/index.ts"),
      "@project/protocol": path.resolve(__dirname, "../../packages/protocol/src/index.ts"),
      "@project/client-core": path.resolve(__dirname, "../../packages/client-core/src/index.ts"),
      "@project/platform-adapters": path.resolve(__dirname, "../../packages/platform-adapters/src/index.ts"),
    },
  },
  server: {
    port: 1480,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
