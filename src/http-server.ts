#!/usr/bin/env node

/**
 * HTTP Server Entry Point for Docker Deployment
 *
 * Provides Streamable HTTP transport for remote MCP clients.
 * Use src/index.ts for local stdio-based usage.
 *
 * Endpoints:
 *   GET  /health  — liveness probe
 *   POST /mcp     — MCP Streamable HTTP (session-aware)
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  searchDecisions,
  getDecision,
  searchGuidelines,
  getGuideline,
  listTopics,
  getDataFreshness,
} from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const SERVER_NAME = "czech-data-protection-mcp";

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback
}

// --- Tool definitions (shared with index.ts) ---------------------------------

const TOOLS = [
  {
    name: "cz_dp_search_decisions",
    description:
      "Full-text search across UOOU decisions (sanctions, reprimands, and administrative decisions). Returns matching decisions with reference, entity name, fine amount, and GDPR articles cited.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query (e.g., 'Clearview AI', 'biometric data')" },
        type: {
          type: "string",
          enum: ["sanction", "decision", "reprimand", "opinion"],
          description: "Filter by decision type. Optional.",
        },
        topic: { type: "string", description: "Filter by topic ID. Optional." },
        limit: { type: "number", description: "Max results (default 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "cz_dp_get_decision",
    description:
      "Get a specific UOOU decision by reference number (e.g., 'UOOU-2022-001').",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: { type: "string", description: "UOOU decision reference" },
      },
      required: ["reference"],
    },
  },
  {
    name: "cz_dp_search_guidelines",
    description:
      "Search UOOU guidance documents: guidelines, opinions, recommendations, and circulars.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        type: {
          type: "string",
          enum: ["guideline", "opinion", "recommendation", "FAQ"],
          description: "Filter by guidance type. Optional.",
        },
        topic: { type: "string", description: "Filter by topic ID. Optional." },
        limit: { type: "number", description: "Max results (default 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "cz_dp_get_guideline",
    description: "Get a specific UOOU guidance document by its database ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Guideline database ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "cz_dp_list_topics",
    description: "List all covered data protection topics with Czech and English names.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "cz_dp_about",
    description: "Return metadata about this MCP server: version, data source, coverage, and tool list.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "cz_dp_list_sources",
    description: "List all data sources used by this server with provenance metadata: authority, URL, coverage scope, language, and update frequency.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "cz_dp_check_data_freshness",
    description: "Check data freshness for each source. Reports latest record dates and record counts to assess how current the data is.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
];

// --- Zod schemas -------------------------------------------------------------

const SearchDecisionsArgs = z.object({
  query: z.string().min(1),
  type: z.enum(["sanction", "decision", "reprimand", "opinion"]).optional(),
  topic: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetDecisionArgs = z.object({
  reference: z.string().min(1),
});

const SearchGuidelinesArgs = z.object({
  query: z.string().min(1),
  type: z.enum(["guideline", "opinion", "recommendation", "FAQ"]).optional(),
  topic: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetGuidelineArgs = z.object({
  id: z.number().int().positive(),
});

// --- MCP server factory ------------------------------------------------------

function createMcpServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: pkgVersion },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    const RESPONSE_META = {
      disclaimer:
        "Data sourced from official ÚOOÚ publications. Research tool only — not legal advice. Verify all references against primary sources before making compliance decisions.",
      copyright: "ÚOOÚ (Úřad pro ochranu osobních údajů) — public regulatory data",
      source_url: "https://www.uoou.cz/",
    };

    function textContent(data: unknown) {
      const payload =
        typeof data === "object" && data !== null
          ? { ...(data as Record<string, unknown>), _meta: RESPONSE_META }
          : { data, _meta: RESPONSE_META };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }

    function errorContent(message: string) {
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true as const,
      };
    }

    try {
      switch (name) {
        case "cz_dp_search_decisions": {
          const parsed = SearchDecisionsArgs.parse(args);
          const results = searchDecisions({
            query: parsed.query,
            type: parsed.type,
            topic: parsed.topic,
            limit: parsed.limit,
          });
          return textContent({ results, count: results.length });
        }

        case "cz_dp_get_decision": {
          const parsed = GetDecisionArgs.parse(args);
          const decision = getDecision(parsed.reference);
          if (!decision) {
            return errorContent(`Decision not found: ${parsed.reference}`);
          }
          return textContent(decision);
        }

        case "cz_dp_search_guidelines": {
          const parsed = SearchGuidelinesArgs.parse(args);
          const results = searchGuidelines({
            query: parsed.query,
            type: parsed.type,
            topic: parsed.topic,
            limit: parsed.limit,
          });
          return textContent({ results, count: results.length });
        }

        case "cz_dp_get_guideline": {
          const parsed = GetGuidelineArgs.parse(args);
          const guideline = getGuideline(parsed.id);
          if (!guideline) {
            return errorContent(`Guideline not found: id=${parsed.id}`);
          }
          return textContent(guideline);
        }

        case "cz_dp_list_topics": {
          const topics = listTopics();
          return textContent({ topics, count: topics.length });
        }

        case "cz_dp_about": {
          return textContent({
            name: SERVER_NAME,
            version: pkgVersion,
            description:
              "ÚOOÚ (Úřad pro ochranu osobních údajů — Czech Data Protection Authority) MCP server. Provides access to Czech data protection authority decisions, sanctions, reprimands, and official guidance documents.",
            data_source: "ÚOOÚ (https://www.uoou.cz/)",
            coverage: {
              decisions: "ÚOOÚ sanctions, decisions, and reprimands",
              guidelines: "ÚOOÚ guidelines, opinions, recommendations, and FAQs",
              topics: "Consent, cookies, transfers, DPIA, breach notification, privacy by design, CCTV, health data, children",
            },
            tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
          });
        }

        case "cz_dp_list_sources": {
          return textContent({
            sources: [
              {
                id: "uoou-decisions",
                name: "ÚOOÚ Decisions and Sanctions",
                authority: "Úřad pro ochranu osobních údajů (ÚOOÚ)",
                url: "https://www.uoou.cz/",
                type: "decisions",
                language: "cs",
                coverage:
                  "GDPR enforcement decisions, sanctions, and reprimands from the Czech Data Protection Authority",
                license: "Public regulatory data — official government publications",
                update_frequency: "Periodic",
              },
              {
                id: "uoou-guidelines",
                name: "ÚOOÚ Guidelines and Opinions",
                authority: "Úřad pro ochranu osobních údajů (ÚOOÚ)",
                url: "https://www.uoou.cz/",
                type: "guidelines",
                language: "cs",
                coverage:
                  "Official guidance documents, opinions, recommendations, and FAQs on GDPR implementation",
                license: "Public regulatory data — official government publications",
                update_frequency: "Periodic",
              },
            ],
            count: 2,
          });
        }

        case "cz_dp_check_data_freshness": {
          const freshness = getDataFreshness();
          const checkedAt = new Date().toISOString().slice(0, 10);
          return textContent({
            checked_at: checkedAt,
            sources: [
              {
                id: "uoou-decisions",
                latest_date: freshness.decisions_latest_date,
                record_count: freshness.decisions_count,
                status: freshness.decisions_count > 0 ? "available" : "empty",
              },
              {
                id: "uoou-guidelines",
                latest_date: freshness.guidelines_latest_date,
                record_count: freshness.guidelines_count,
                status: freshness.guidelines_count > 0 ? "available" : "empty",
              },
            ],
            note: "Database updates are periodic. Use cz_dp_list_sources for full source provenance.",
          });
        }

        default:
          return errorContent(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorContent(`Error executing ${name}: ${message}`);
    }
  });

  return server;
}

// --- HTTP server -------------------------------------------------------------

async function main(): Promise<void> {
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: Server }
  >();

  const httpServer = createServer((req, res) => {
    handleRequest(req, res, sessions).catch((err) => {
      console.error(`[${SERVER_NAME}] Unhandled error:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  });

  async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    activeSessions: Map<
      string,
      { transport: StreamableHTTPServerTransport; server: Server }
    >,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: SERVER_NAME, version: pkgVersion }));
      return;
    }

    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      const mcpServer = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK type mismatch with exactOptionalPropertyTypes
      await mcpServer.connect(transport as any);

      transport.onclose = () => {
        if (transport.sessionId) {
          activeSessions.delete(transport.sessionId);
        }
        mcpServer.close().catch(() => {});
      };

      await transport.handleRequest(req, res);

      if (transport.sessionId) {
        activeSessions.set(transport.sessionId, { transport, server: mcpServer });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  httpServer.listen(PORT, () => {
    console.error(`${SERVER_NAME} v${pkgVersion} (HTTP) listening on port ${PORT}`);
    console.error(`MCP endpoint:  http://localhost:${PORT}/mcp`);
    console.error(`Health check:  http://localhost:${PORT}/health`);
  });

  process.on("SIGTERM", () => {
    console.error("Received SIGTERM, shutting down...");
    httpServer.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
