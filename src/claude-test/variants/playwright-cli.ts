import type { ClaudeVariantConfig } from "../types";

export const playwrightCli: ClaudeVariantConfig = {
  name: "claude-playwright-cli",
  allowedTools: "Bash,Read,Write",
  installCommand: "npm install -g @playwright/cli@latest",
  toolPrompt: `You have the \`playwright-cli\` CLI available via Bash. Key commands:
- \`playwright-cli open <url>\` — Navigate to a URL
- \`playwright-cli snapshot\` — Get page accessibility snapshot
- \`playwright-cli click <ref>\` — Click an element by ref
- \`playwright-cli fill <ref> <text>\` — Fill a form field
- \`playwright-cli type <text>\` — Type text

Use \`playwright-cli snapshot\` to see the page and get element refs for interaction.`,
};
