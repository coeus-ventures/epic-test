import type { ClaudeVariantConfig } from "../types";

const MCP_CONFIG_PATH = "/tmp/mcp.json";

const mcpConfigJson = JSON.stringify({
  mcpServers: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest", "--browser-channel", "chromium"],
    },
  },
});

export const mcp: ClaudeVariantConfig = {
  name: "claude-mcp",
  allowedTools: "Bash,Read,Write,Edit,mcp__playwright__*",
  mcpConfigPath: MCP_CONFIG_PATH,
  setupCommands: [
    `echo '${mcpConfigJson}' > ${MCP_CONFIG_PATH}`,
  ],
  toolPrompt: `You have Playwright browser tools available via MCP. Key tools:
- \`browser_navigate\` — Go to a URL
- \`browser_snapshot\` — Get accessibility tree of current page
- \`browser_click\` — Click an element (use accessibility snapshot refs)
- \`browser_fill\` — Type text into an input field
- \`browser_type\` — Type text character by character

Use \`browser_snapshot\` frequently to understand the current page state.
Navigate with \`browser_navigate\` and interact with \`browser_click\` and \`browser_fill\`.`,
};
