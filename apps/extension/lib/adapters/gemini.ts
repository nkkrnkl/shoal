import { createSelectorAdapter } from "./selector-adapter";

/** gemini.google.com. Conversations live at /app/<id>, /u/<n>/app/<id> or /gem/<gem>/<id>. */
export const geminiAdapter = createSelectorAdapter("gemini.google.com");
