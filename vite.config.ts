import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/pdfjs-dist/")) return "pdf-renderer";
          if (id.includes("/node_modules/pdf-lib/")) return "pdf-writer";
          if (id.includes("/node_modules/react/")) return "react-vendor";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
  },
});
