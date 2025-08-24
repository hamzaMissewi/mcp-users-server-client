import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { confirm, input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CreateMessageRequestSchema,
  Prompt,
  PromptMessage,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { generateText, jsonSchema, ToolSet } from "ai";
// import fs from "node:fs/promises";
import os from "os";
import path from "path";
import * as fs from "fs/promises";

const mcp = new Client(
  {
    // name: "text-client-video",
    name: "text-client-hamza",
    version: "1.0.0",
  },
  { capabilities: { sampling: {} } }
);

const transport = new StdioClientTransport({
  command: "node",
  args: ["build/server.js"],
  stderr: "ignore",
});

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  await mcp.connect(transport);
  const [{ tools }, { prompts }, { resources }, { resourceTemplates }] =
    await Promise.all([
      mcp.listTools(),
      mcp.listPrompts(),
      mcp.listResources(),
      mcp.listResourceTemplates(),
    ]);

  mcp.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    const texts: string[] = [];
    for (const message of request.params.messages) {
      const text = await handleServerMessagePrompt(message);
      if (text != null) texts.push(text);
    }

    return {
      role: "user",
      model: "gemini-2.0-flash",
      stopReason: "endTurn",
      content: {
        type: "text",
        text: texts.join("\n"),
      },
    };
  });

  console.log("You are connected!");
  while (true) {
    const option = await select({
      message: "What would you like to do",
      choices: ["Query", "Tools", "Resources", "Prompts"],
    });

    switch (option) {
      case "Tools":
        const toolName = await select({
          message: "Select a tool",
          choices: tools.map((tool) => ({
            name: tool.annotations?.title || tool.name,
            value: tool.name,
            description: tool.description,
          })),
        });
        const tool = tools.find((t) => t.name === toolName);
        if (tool == null) {
          console.error("Tool not found.");
        } else {
          await handleTool(tool);
        }
        break;
      case "Resources":
        const resourceUri = await select({
          message: "Select a resource",
          choices: [
            ...resources.map((resource) => ({
              name: resource.name,
              value: resource.uri,
              description: resource.description,
            })),
            ...resourceTemplates.map((template) => ({
              name: template.name,
              value: template.uriTemplate,
              description: template.description,
            })),
          ],
        });
        const uri =
          resources.find((r) => r.uri === resourceUri)?.uri ??
          resourceTemplates.find((r) => r.uriTemplate === resourceUri)
            ?.uriTemplate;
        if (uri == null) {
          console.error("Resource not found.");
        } else {
          await handleResource(uri);
        }
        break;
      case "Prompts":
        const promptName = await select({
          message: "Select a prompt",
          choices: prompts.map((prompt) => ({
            name: prompt.name,
            value: prompt.name,
            description: prompt.description,
          })),
        });
        const prompt = prompts.find((p) => p.name === promptName);
        if (prompt == null) {
          console.error("Prompt not found.");
        } else {
          await handlePrompt(prompt);
        }
        break;
      case "Query":
        await handleQuery(tools);
    }
  }
}

async function handleQuery(tools: Tool[]) {
  const query = await input({ message: "Enter your query" });

  const { text, toolResults } = await generateText({
    model: google("gemini-2.0-flash"),
    prompt: query,
    tools: tools.reduce(
      (obj, tool) => ({
        ...obj,
        [tool.name]: {
          description: tool.description,
          parameters: jsonSchema(tool.inputSchema),
          execute: async (args: Record<string, any>) => {
            return await mcp.callTool({
              name: tool.name,
              arguments: args,
            });
          },
        },
      }),
      {} as ToolSet
    ),
  });

  console.log(
    // @ts-expect-error
    text || toolResults[0]?.result?.content[0]?.text || "No text generated."
  );
}

async function handleTool(tool: Tool) {
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    tool.inputSchema.properties ?? {}
  )) {
    args[key] = await input({
      message: `Enter value for ${key} (${(value as { type: string }).type}):`,
    });
  }

  const res = await mcp.callTool({
    name: tool.name,
    arguments: args,
  });

  console.log((res.content as [{ text: string }])[0].text);
}

async function handleResource(uri: string) {
  let finalUri = uri;
  const paramMatches = uri.match(/{([^}]+)}/g);

  if (paramMatches != null) {
    for (const paramMatch of paramMatches) {
      const paramName = paramMatch.replace("{", "").replace("}", "");
      const paramValue = await input({
        message: `Enter value for ${paramName}:`,
      });
      finalUri = finalUri.replace(paramMatch, paramValue);
    }
  }

  const res = await mcp.readResource({
    uri: finalUri,
  });

  console.log(
    JSON.stringify(JSON.parse(res.contents[0].text as string), null, 2)
  );
}

async function handlePrompt(prompt: Prompt) {
  const args: Record<string, string> = {};
  for (const arg of prompt.arguments ?? []) {
    args[arg.name] = await input({
      message: `Enter value for ${arg.name}:`,
    });
  }

  const response = await mcp.getPrompt({
    name: prompt.name,
    arguments: args,
  });

  console.log("mcp getPrompt response:", JSON.stringify(response, null, 2));

  for (const message of response.messages) {
    // console.log(await handleServerMessagePrompt(message));
    const aiText = await handleServerMessagePrompt(message);
    if (!aiText) continue;
    console.log("output ai:", aiText);

    // 1) Save raw AI output
    // const outputTxtPathname = path.join(__dirname, "data/ai-latest-output.txt");
    // await fs.writeFile(outputTxtPathname, JSON.stringify(aiText, null, 2));
    const outputTxtPathname = path.resolve(
      process.cwd(),
      "src/data/ai-latest-output.txt"
    );
    await fs.writeFile(outputTxtPathname, aiText, "utf8");

    // 2) Try to parse user data
    const user = parseUserFromText(aiText);
    if (!user) {
      console.log("AI output did not contain a valid user payload.");
      continue;
    }
    const { tools } = await mcp.listTools();

    // const tool = tools.find((tool) => tool.name === "save-user-to-json-file");
    const tool = tools.find((tool) => tool.name === "create-user");
    if (!tool) {
      console.log("Tool not found: create-user");
      continue;
    }

    // 3) Use MCP tool to persist
    console.log("tool details: ", tool);
    const res = await mcp.callTool({
      name: tool.name,
      arguments: user,
      // content: [{ type: "text", text: aiText }],
    });

    // console.log(res.toolResult);
    // console.log((resContent as [{ text: string }])[0].text);

    console.log(
      (res.content as [{ text: string }])[0]?.text ??
        "Create-user: no response text"
    );
    if (typeof res.content !== "string") continue;

    const resContent = JSON.parse(res.content);
    console.log("save user tool response", resContent);
    if (typeof resContent !== "object" || resContent === null) continue;

    const userJsonPathname = path.resolve(process.cwd(), "src/data/users.json");
    fs.appendFile(userJsonPathname, JSON.stringify(user, null, 2));
  }
}

function parseUserFromText(
  text: string
): { name: string; email: string; address?: string; phone?: string } | null {
  try {
    // Strip code fences if present
    const cleaned = text
      .trim()
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/, "")
      .trim();

    const obj = JSON.parse(cleaned);

    // Normalize common variants:
    // Name
    let name: string | undefined =
      obj.name ??
      (obj.firstName && obj.lastName
        ? `${obj.firstName} ${obj.lastName}`
        : undefined);

    // Address (string or object)
    let address: string | undefined = obj.address;
    if (address && typeof address === "object") {
      const { street, city, state, zip, zipCode } = address as any;
      const zipStr = zip ?? zipCode;
      address = [street, city, state, zipStr].filter(Boolean).join(", ");
    }

    // Phone
    let phone: string | undefined = obj.phone ?? obj.phoneNumber;

    const email: string | undefined = obj.email;

    // if (!name || !email || !address || !phone) return null;
    if (!name || !email) return null;

    return { name, email, address, phone };
  } catch {
    return null;
  }
}

async function handleServerMessagePrompt(message: PromptMessage) {
  if (message.content.type !== "text") return;

  console.log(message.content.text);
  const run = await confirm({
    message: "Would you like to run the above prompt",
    default: true,
  });

  if (!run) return;

  const { text } = await generateText({
    model: google("gemini-2.0-flash"),
    prompt: message.content.text,
  });

  return text;
}

main();
