import type { ClaudeVariantConfig } from "../types";

export const agentBrowser: ClaudeVariantConfig = {
  name: "claude-agent-browser",
  allowedTools: "Bash,Read,Write",
  installCommand: "npm install -g agent-browser",
  toolPrompt: `You have the \`agent-browser\` CLI available via Bash. Key commands:
- \`agent-browser open <url>\` — Navigate to a URL
- \`agent-browser snapshot\` — Get accessibility tree (structured JSON)
- \`agent-browser click <selector>\` — Click an element
- \`agent-browser fill <selector> <text>\` — Fill a form field
- \`agent-browser type <text>\` — Type text

Use \`agent-browser snapshot\` to understand the page and find selectors.
Selectors can be semantic: role, label, text content.`,
};
