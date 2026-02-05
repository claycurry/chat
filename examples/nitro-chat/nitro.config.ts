import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  traceDeps: [
    "@discordjs/ws",
  ],
});
