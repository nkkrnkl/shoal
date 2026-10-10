import { defineConfig } from "wxt";
import { CHAT_SITE_MATCHES } from "./lib/site";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  zip: { artifactTemplate: "shoal-{{version}}-{{browser}}.zip" },
  manifest: ({ mode }) => {
    const key = process.env.SHOAL_EXTENSION_KEY;
    return {
      name: mode === "production" ? "Shoal" : "Shoal (dev)",
      description: "Picks the right model for your prompt, flags stale context, and coaches your prompts.",
      permissions: ["sidePanel", "storage", "offscreen"],
      host_permissions: CHAT_SITE_MATCHES,
      action: { default_title: "Open Shoal" },
      // WebAssembly for on-device inference needs wasm-unsafe-eval. No remote code is ever loaded.
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      },
      ...(key ? { key } : {}),
    };
  },
});
