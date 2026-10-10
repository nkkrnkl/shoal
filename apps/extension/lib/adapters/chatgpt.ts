import { createSelectorAdapter } from "./selector-adapter";

/** chatgpt.com. Conversations live at /c/<uuid>, optionally under /g/<gpt or project>/. */
export const chatgptAdapter = createSelectorAdapter("chatgpt.com");
