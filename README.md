# Czech Data Protection MCP

<!-- ANSVAR-CTA-BEGIN -->
> ### ▶ Try this MCP instantly via Ansvar Gateway
> **50 free queries/day · no card required · OAuth signup at [ansvar.eu/gateway](https://ansvar.eu/gateway)**
>
> One endpoint, one OAuth signup, access from any MCP-compatible client.

### Connect

**Claude Code** (one line):

```bash
claude mcp add ansvar --transport http https://gateway.ansvar.eu/mcp
```

**Claude Desktop / Cursor** — add to `claude_desktop_config.json` (or `mcp.json`):

```json
{
  "mcpServers": {
    "ansvar": {
      "type": "url",
      "url": "https://gateway.ansvar.eu/mcp"
    }
  }
}
```

**Claude.ai** — Settings → Connectors → Add custom connector → paste `https://gateway.ansvar.eu/mcp`

First request opens an OAuth flow at [ansvar.eu/gateway](https://ansvar.eu/gateway). After signup, your client is bound to your account; tier (free / premium / team / company) determines fan-out, quota, and which downstream MCPs are reachable.

---

## Self-host this MCP

You can also clone this repo and build the corpus yourself. The schema,
fetcher, and tool implementations all live here. What is not in the repo is
the pre-built database — TDM and standards-licensing constraints on the
upstream sources mean we host the corpus on Ansvar infrastructure rather
than redistribute it as a public artifact.

Build your own: run this repo's ingestion script (entry-point varies per
repo — typically `scripts/ingest.sh`, `npm run ingest`, or `make ingest`;
check the repo root).
<!-- ANSVAR-CTA-END -->


**Czech data protection data for AI compliance tools.**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CI](https://github.com/Ansvar-Systems/czech-data-protection-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/czech-data-protection-mcp/actions/workflows/ci.yml)

Query Czech data protection data -- regulations, decisions, and requirements from UOOU (Office for Personal Data Protection) -- directly from Claude, Cursor, or any MCP-compatible client.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Available Tools (8)

| Tool | Description |
|------|-------------|
| `cz_dp_search_decisions` | Full-text search across ÚOOÚ decisions (sanctions, decisions, and reprimands). Returns matching decisions with reference, entity name, fine amount, and GDPR articles cited. |
| `cz_dp_get_decision` | Get a specific ÚOOÚ decision by reference number (e.g., `UOOU-00350/22-28`). |
| `cz_dp_search_guidelines` | Search ÚOOÚ guidance documents: guidelines, opinions, recommendations, and FAQs. Covers GDPR implementation, DPIA methodology, cookies, CCTV, and more. |
| `cz_dp_get_guideline` | Get a specific ÚOOÚ guidance document by its database ID. |
| `cz_dp_list_topics` | List all covered data protection topics with Czech and English names. Use topic IDs to filter decisions and guidelines. |
| `cz_dp_about` | Return metadata about this MCP server: version, data source, coverage, and tool list. |
| `cz_dp_list_sources` | List all data sources with provenance metadata: authority, URL, coverage scope, language, and update frequency. |
| `cz_dp_check_data_freshness` | Check data freshness: latest record dates and record counts per source. |

All tools return structured data with a `_meta` block containing disclaimer, copyright, and source URL. See [TOOLS.md](TOOLS.md) for full parameter reference.

---

## Data Sources and Freshness

All content is sourced from official Czech regulatory publications:

- **UOOU (Office for Personal Data Protection)** -- Official regulatory authority

### Data Currency

- Database updates are periodic and may lag official publications
- Use `cz_dp_check_data_freshness` to check the latest record dates in the live database
- Use `cz_dp_list_sources` for full provenance metadata

See [COVERAGE.md](COVERAGE.md) for full coverage details.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Not Regulatory Advice

> **THIS TOOL IS NOT REGULATORY OR LEGAL ADVICE**
>
> Regulatory data is sourced from official publications by UOOU (Office for Personal Data Protection). However:
> - This is a **research tool**, not a substitute for professional regulatory counsel
> - **Verify all references** against primary sources before making compliance decisions
> - **Coverage may be incomplete** -- do not rely solely on this for regulatory research

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. See [PRIVACY.md](PRIVACY.md) for details.

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/czech-data-protection-mcp
cd czech-data-protection-mcp
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run seed    # Seed the SQLite database with sample data
npm run ingest  # Run the ÚOOÚ ingestion crawler
```

---

## More Ansvar MCPs

Full fleet at [ansvar.eu/gateway](https://ansvar.eu/gateway).
## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

Regulatory data sourced from official government publications. See [COVERAGE.md](COVERAGE.md) for per-source details.

---

## About Ansvar Systems

We build AI-powered compliance and legal research tools for the European market. Our MCP fleet provides structured, verified regulatory data to AI assistants -- so compliance professionals can work with accurate sources instead of guessing.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
