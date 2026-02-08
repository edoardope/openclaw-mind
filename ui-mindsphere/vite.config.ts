import { defineConfig } from "vite";

export default defineConfig({
  // Important: MindSphere UI is served under /ms, so assets must be rooted there.
  base: "/ms/",
  build: {
    outDir: "../dist/mindsphere-ui",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5175,
    strictPort: false,
  },
});
