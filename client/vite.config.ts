import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        // The Express server handles /api itself and adds the API key
        target: "http://localhost:3000",
      },
    },
  },
});