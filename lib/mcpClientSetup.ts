export type McpClientId = "claude" | "codex" | "mistral";

export type McpClientSetupStep = {
  title: string;
  /** Short instruction shown above the snippet (or on its own when there is no snippet). */
  note?: string;
  /** Copyable command or config; omitted for steps that only describe UI clicks. */
  code?: string;
  copyLabel?: string;
};

export type McpClientSetupSection = {
  id: McpClientId;
  label: string;
  steps: McpClientSetupStep[];
};

export const MCP_TOKEN_PLACEHOLDER = "<token>";
export const MCP_CLIENT_SERVER_NAME = "noctua-mail";
const MCP_TOKEN_ENV_VAR = "NOCTUA_MCP_TOKEN";

export type McpClientSetupInput = {
  serverUrl: string;
  /** Freshly created token secret; the placeholder is used when none is at hand. */
  token?: string | null;
};

export function buildMcpClientSetupSections({
  serverUrl,
  token
}: McpClientSetupInput): McpClientSetupSection[] {
  const tokenValue = token?.trim() || MCP_TOKEN_PLACEHOLDER;
  const bearer = `Bearer ${tokenValue}`;

  return [
    {
      id: "claude",
      label: "Claude",
      steps: [
        {
          title: "Claude Code",
          note: "Registers the server for all your projects. Run it once in a terminal.",
          code: [
            "claude mcp add --transport http --scope user",
            `  ${MCP_CLIENT_SERVER_NAME} ${serverUrl}`,
            `  --header "Authorization: ${bearer}"`
          ].join(" \\\n"),
          copyLabel: "Copy Claude Code command"
        },
        {
          title: "Claude Desktop and claude.ai",
          note:
            "Customize › Connectors › Add custom connector. Enter the server URL, choose \"No sign-in\" and add a request header named Authorization with this value:",
          code: bearer,
          copyLabel: "Copy Authorization header value"
        },
        {
          title: "Claude Desktop without request headers",
          note:
            "Request headers are still rolling out. If the dialog lacks them, bridge the server through mcp-remote in claude_desktop_config.json:",
          code: JSON.stringify(
            {
              mcpServers: {
                [MCP_CLIENT_SERVER_NAME]: {
                  command: "npx",
                  args: [
                    "-y",
                    "mcp-remote",
                    serverUrl,
                    "--transport",
                    "http-only",
                    "--header",
                    `Authorization:\${${MCP_TOKEN_ENV_VAR}}`
                  ],
                  env: { [MCP_TOKEN_ENV_VAR]: bearer }
                }
              }
            },
            null,
            2
          ),
          copyLabel: "Copy claude_desktop_config.json entry"
        }
      ]
    },
    {
      id: "codex",
      label: "ChatGPT / Codex",
      steps: [
        {
          title: "Codex CLI",
          note:
            "Codex reads the token from an environment variable, so export it in your shell profile and register the server once.",
          code: [
            `export ${MCP_TOKEN_ENV_VAR}="${tokenValue}"`,
            `codex mcp add ${MCP_CLIENT_SERVER_NAME} --url ${serverUrl} --bearer-token-env-var ${MCP_TOKEN_ENV_VAR}`
          ].join("\n"),
          copyLabel: "Copy Codex commands"
        },
        {
          title: "Codex config file",
          note: "Alternatively add the server with the token inline to ~/.codex/config.toml:",
          code: [
            `[mcp_servers.${MCP_CLIENT_SERVER_NAME}]`,
            `url = "${serverUrl}"`,
            `http_headers = { Authorization = "${bearer}" }`
          ].join("\n"),
          copyLabel: "Copy Codex config"
        },
        {
          title: "ChatGPT",
          note:
            "Custom MCP servers added at chatgpt.com/plugins connect only through OAuth or without authentication. Noctua authenticates with a bearer token, so use Codex instead."
        }
      ]
    },
    {
      id: "mistral",
      label: "Mistral",
      steps: [
        {
          title: "Le Chat",
          note:
            "Connectors › Add Connector › Custom MCP Connector (workspace admins only). Enter the server URL and, when asked for credentials, send this Authorization header value as the bearer token:",
          code: bearer,
          copyLabel: "Copy Authorization header value"
        },
        {
          title: "Vibe CLI",
          note: "Add the server to ~/.vibe/config.toml (or ./.vibe/config.toml for one project):",
          code: [
            "[[mcp_servers]]",
            `name = "${MCP_CLIENT_SERVER_NAME}"`,
            'transport = "streamable-http"',
            `url = "${serverUrl}"`,
            "",
            "[mcp_servers.auth]",
            'type = "static"',
            `headers = { Authorization = "${bearer}" }`
          ].join("\n"),
          copyLabel: "Copy Vibe config"
        }
      ]
    }
  ];
}
