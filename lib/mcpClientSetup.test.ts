import { describe, expect, it } from "bun:test";
import {
  MCP_CLIENT_SERVER_NAME,
  MCP_TOKEN_PLACEHOLDER,
  buildMcpClientSetupSections
} from "./mcpClientSetup";

const serverUrl = "https://mail.example.test/api/mcp";

function codeSnippets(token?: string | null) {
  return buildMcpClientSetupSections({ serverUrl, token })
    .flatMap((section) => section.steps)
    .flatMap((step) => (step.code ? [step.code] : []));
}

describe("buildMcpClientSetupSections", () => {
  it("covers Claude, Codex and Mistral", () => {
    const sections = buildMcpClientSetupSections({ serverUrl });
    expect(sections.map((section) => section.id)).toEqual(["claude", "codex", "mistral"]);
    for (const section of sections) {
      expect(section.steps.length).toBeGreaterThan(0);
      for (const step of section.steps) {
        if (step.code) expect(step.copyLabel).toBeTruthy();
      }
    }
  });

  it("uses the placeholder until a token exists and never mixes both", () => {
    for (const snippet of codeSnippets()) {
      expect(snippet).toContain(MCP_TOKEN_PLACEHOLDER);
    }
    for (const snippet of codeSnippets("mcp_secret-123")) {
      expect(snippet).toContain("mcp_secret-123");
      expect(snippet).not.toContain(MCP_TOKEN_PLACEHOLDER);
    }
    expect(codeSnippets("   ")).toEqual(codeSnippets(null));
  });

  it("builds the Claude Code command with the HTTP transport and bearer header", () => {
    const [claude] = buildMcpClientSetupSections({ serverUrl, token: "mcp_abc" });
    const command = claude.steps[0].code ?? "";
    expect(command).toContain("claude mcp add --transport http");
    expect(command).toContain(`${MCP_CLIENT_SERVER_NAME} ${serverUrl}`);
    expect(command).toContain('--header "Authorization: Bearer mcp_abc"');
  });

  it("emits a valid claude_desktop_config.json entry that bridges through mcp-remote", () => {
    const [claude] = buildMcpClientSetupSections({ serverUrl, token: "mcp_abc" });
    const entry = JSON.parse(claude.steps[2].code ?? "") as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    const server = entry.mcpServers[MCP_CLIENT_SERVER_NAME];
    expect(server.command).toBe("npx");
    expect(server.args).toContain("mcp-remote");
    expect(server.args).toContain(serverUrl);
    expect(server.args).toContain("Authorization:${NOCTUA_MCP_TOKEN}");
    expect(server.env.NOCTUA_MCP_TOKEN).toBe("Bearer mcp_abc");
  });

  it("points Codex at the token environment variable and offers an inline config", () => {
    const codex = buildMcpClientSetupSections({ serverUrl, token: "mcp_abc" })[1];
    expect(codex.steps[0].code).toContain('export NOCTUA_MCP_TOKEN="mcp_abc"');
    expect(codex.steps[0].code).toContain(
      `codex mcp add ${MCP_CLIENT_SERVER_NAME} --url ${serverUrl} --bearer-token-env-var NOCTUA_MCP_TOKEN`
    );
    expect(codex.steps[1].code).toContain(`[mcp_servers.${MCP_CLIENT_SERVER_NAME}]`);
    expect(codex.steps[1].code).toContain(`url = "${serverUrl}"`);
    expect(codex.steps[1].code).toContain('http_headers = { Authorization = "Bearer mcp_abc" }');
    const chatGpt = codex.steps.find((step) => step.title === "ChatGPT");
    expect(chatGpt?.code).toBeUndefined();
    expect(chatGpt?.note).toContain("OAuth");
  });

  it("builds a streamable-http Vibe entry with static auth", () => {
    const mistral = buildMcpClientSetupSections({ serverUrl, token: "mcp_abc" })[2];
    const vibe = mistral.steps[1].code ?? "";
    expect(vibe).toContain("[[mcp_servers]]");
    expect(vibe).toContain(`name = "${MCP_CLIENT_SERVER_NAME}"`);
    expect(vibe).toContain('transport = "streamable-http"');
    expect(vibe).toContain(`url = "${serverUrl}"`);
    expect(vibe).toContain('type = "static"');
    expect(vibe).toContain('headers = { Authorization = "Bearer mcp_abc" }');
  });
});
