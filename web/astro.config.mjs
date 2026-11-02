import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://agents-anonymous.pages.dev",
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [sitemap({ filter: (page) => !page.includes("/404") && !page.includes("/md/") && !page.endsWith("/meeting/share") })],
  vite: {
    server: { fs: { allow: [".."] } },
    build: { assetsInlineLimit: 0 },
  },
});
