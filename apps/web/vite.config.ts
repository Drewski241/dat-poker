import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(process.cwd(), "../.."), "");
  const apiPort = env.API_PORT ?? "4000";

  return {
    plugins: [react()],
    server: {
      host: env.WEB_HOST ?? "0.0.0.0",
      port: Number(env.WEB_PORT ?? 5173),
      proxy: {
        "/v1": `http://localhost:${apiPort}`,
        "/health": `http://localhost:${apiPort}`,
      },
    },
  };
});
