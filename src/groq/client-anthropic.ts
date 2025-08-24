const { Anthropic } = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function main() {
  async function queryAIWithMCP(prompt: string, mcpServerUrl: string) {
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "mcp", url: mcpServerUrl }], // Connect to your MCP server
    });
    return message.content;
  }
}

main();
