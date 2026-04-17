#!/usr/bin/env node

/**
 * Czech Data Protection MCP — stdio entry point.
 *
 * Provides MCP tools for querying ÚOOÚ decisions, sanctions, and
 * data protection guidance documents.
 *
 * Tool prefix: cz_dp_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  searchDecisions,
  getDecision,
  searchGuidelines,
  getGuideline,
  listTopics,
  getDataFreshness,
} from "./db.js";
import { buildCitation } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "czech-data-protection-mcp";

// --- Tool definitions ---------------------------------------------------------

const TOOLS = [
  {
    name: "cz_dp_search_decisions",
    description:
      "Full-text search across ÚOOÚ decisions (sanctions, decisions, and reprimands). Returns matching decisions with reference, entity name, fine amount, and GDPR articles cited.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query in Czech or English (e.g., 'O2 osobní údaje', 'cookies souhlas', 'data breach')",
        },
        type: {
          type: "string",
          enum: ["sanction", "decision", "reprimand", "opinion"],
          description: "Filter by decision type. Optional.",
        },
        topic: {
          type: "string",
          description: "Filter by topic ID (e.g., 'consent', 'cookies', 'transfers'). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "cz_dp_get_decision",
    description:
      "Get a specific ÚOOÚ decision by reference number (e.g., 'UOOU-00350/22-28', 'UOOU-05117/19-4').",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "ÚOOÚ decision reference (e.g., 'UOOU-00350/22-28', 'UOOU-05117/19-4')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "cz_dp_search_guidelines",
    description:
      "Search ÚOOÚ guidance documents: guidelines, opinions, recommendations, and FAQs. Covers GDPR implementation, DPIA methodology, cookies, CCTV (kamerové systémy), and more.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query in Czech or English (e.g., 'kamerové systémy', 'DPIA', 'cookies souhlas')",
        },
        type: {
          type: "string",
          enum: ["guideline", "opinion", "recommendation", "FAQ"],
          description: "Filter by guidance type. Optional.",
        },
        topic: {
          type: "string",
          description: "Filter by topic ID (e.g., 'dpia', 'cookies', 'cctv'). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "cz_dp_get_guideline",
    description:
      "Get a specific ÚOOÚ guidance document by its database ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "number",
          description: "Guideline database ID (from cz_dp_search_guidelines results)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "cz_dp_list_topics",
    description:
      "List all covered data protection topics with Czech and English names. Use topic IDs to filter decisions and guidelines.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "cz_dp_about",
    description: "Return metadata about this MCP server: version, data source, coverage, and tool list.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
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

// --- Zod schemas for argument validation --------------------------------------

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

// --- Helper ------------------------------------------------------------------

const RESPONSE_META = {
  disclaimer:
    "Data sourced from official ÚOOÚ publications. Research tool only — not legal advice. Verify all references against primary sources before making compliance decisions.",
  copyright: "ÚOOÚ (Úřad pro ochranu osobních údajů) — public regulatory data",
  source_url: "https://www.uoou.cz/",
};

function textContent(data: unknown) {
  const payload =
    typeof data === "object" && data !== null
      ? { ...(data as unknown as Record<string, unknown>), _meta: RESPONSE_META }
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

// --- Server setup ------------------------------------------------------------

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

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
        const dec = decision as unknown as Record<string, unknown>;
        return textContent({
          ...dec,
          _citation: buildCitation(
            String(dec.reference ?? parsed.reference),
            String(dec.title ?? dec.reference ?? parsed.reference),
            "cz_dp_get_decision",
            { reference: parsed.reference },
            dec.url != null ? String(dec.url) : undefined,
          ),
        });
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
        const gl = guideline as unknown as Record<string, unknown>;
        return textContent({
          ...gl,
          _citation: buildCitation(
            String(gl.title ?? `Guideline ${parsed.id}`),
            String(gl.title ?? `Guideline ${parsed.id}`),
            "cz_dp_get_guideline",
            { id: String(parsed.id) },
            gl.url != null ? String(gl.url) : undefined,
          ),
        });
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

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
