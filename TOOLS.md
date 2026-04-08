# Tool Reference

This MCP exposes 8 tools under the `cz_dp_` prefix.

## Search Tools

### `cz_dp_search_decisions`

Full-text search across ÚOOÚ decisions (sanctions, decisions, and reprimands).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | yes | Search query in Czech or English |
| `type` | string | no | Filter: `sanction`, `decision`, `reprimand`, `opinion` |
| `topic` | string | no | Filter by topic ID (e.g., `consent`, `cookies`) |
| `limit` | number | no | Max results (default 20, max 100) |

**Returns:** `{ results: Decision[], count: number, _meta: ... }`

---

### `cz_dp_search_guidelines`

Search ÚOOÚ guidance documents: guidelines, opinions, recommendations, and FAQs.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | yes | Search query in Czech or English |
| `type` | string | no | Filter: `guideline`, `opinion`, `recommendation`, `FAQ` |
| `topic` | string | no | Filter by topic ID |
| `limit` | number | no | Max results (default 20, max 100) |

**Returns:** `{ results: Guideline[], count: number, _meta: ... }`

---

## Retrieval Tools

### `cz_dp_get_decision`

Get a specific ÚOOÚ decision by reference number.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `reference` | string | yes | ÚOOÚ reference (e.g., `UOOU-00350/22-28`) |

**Returns:** Full decision object with all fields, or error if not found.

---

### `cz_dp_get_guideline`

Get a specific ÚOOÚ guidance document by its database ID.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | yes | Guideline database ID (from search results) |

**Returns:** Full guideline object with all fields, or error if not found.

---

## Listing Tools

### `cz_dp_list_topics`

List all covered data protection topics with Czech and English names.

**Parameters:** None

**Returns:** `{ topics: Topic[], count: number, _meta: ... }`

---

## Meta Tools

### `cz_dp_about`

Return metadata about this MCP server: version, data source, coverage, and tool list.

**Parameters:** None

**Returns:** Server metadata including version, description, coverage summary, and tool list.

---

### `cz_dp_list_sources`

List all data sources used by this server with provenance metadata.

**Parameters:** None

**Returns:** Array of source objects with authority, URL, coverage scope, language, license, and update frequency.

---

### `cz_dp_check_data_freshness`

Check data freshness for each source. Reports latest record dates and record counts.

**Parameters:** None

**Returns:** `{ checked_at, sources: [{ id, latest_date, record_count, status }], note, _meta }`

---

## Response Shape

All tools include a `_meta` block in the response:

```json
{
  "_meta": {
    "disclaimer": "Data sourced from official ÚOOÚ publications. Research tool only — not legal advice...",
    "copyright": "ÚOOÚ (Úřad pro ochranu osobních údajů) — public regulatory data",
    "source_url": "https://www.uoou.cz/"
  }
}
```
