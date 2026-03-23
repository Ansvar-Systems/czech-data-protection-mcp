#!/usr/bin/env npx tsx
/**
 * Ingestion crawler for the ÚOOÚ (Úřad pro ochranu osobních údajů) website.
 *
 * Crawls uoou.cz for:
 *   - supervisory decisions, sanctions, reprimands (→ decisions table)
 *   - chairman appeal decisions (→ decisions table)
 *   - methodological guidelines, opinions, statements (→ guidelines table)
 *   - topics controlled vocabulary (→ topics table)
 *
 * Usage:
 *   npx tsx scripts/ingest-uoou.ts                 # full crawl
 *   npx tsx scripts/ingest-uoou.ts --resume        # skip already-ingested references
 *   npx tsx scripts/ingest-uoou.ts --dry-run       # fetch and parse but don't write DB
 *   npx tsx scripts/ingest-uoou.ts --force          # drop DB and rebuild from scratch
 *   npx tsx scripts/ingest-uoou.ts --resume --dry-run
 *
 * Environment:
 *   UOOU_DB_PATH   — SQLite database path (default: data/uoou.db)
 *   UOOU_RATE_MS   — milliseconds between HTTP requests (default: 1500)
 */

import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FLAG_RESUME = args.includes("--resume");
const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_FORCE = args.includes("--force");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env["UOOU_DB_PATH"] ?? "data/uoou.db";
const RATE_MS = Number(process.env["UOOU_RATE_MS"] ?? "1500");
const BASE_URL = "https://www.uoou.cz";
const USER_AGENT =
  "AnsvarUOOUCrawler/1.0 (+https://github.com/Ansvar-Systems/czech-data-protection-mcp)";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Index page URLs — each points to a listing page on uoou.cz
// ---------------------------------------------------------------------------

/** Decision listing seeds — supervisory activities, chairman decisions, sanctions. */
const DECISION_SEEDS: SeedConfig[] = [
  // Dozorová a rozhodovací činnost (main supervisory listing)
  {
    url: `${BASE_URL}/dozorova-cinnost/ds-1277`,
    label: "Dozorová činnost — hlavní přehled",
    contentType: "decision",
  },
  // Ukončené kontroly (completed inspections)
  {
    url: `${BASE_URL}/ukoncene-kontroly/ds-5649/archiv=0&p1=1277&rd=1000`,
    label: "Ukončené kontroly",
    contentType: "decision",
  },
  // Kontroly — year-based listings
  {
    url: `${BASE_URL}/kontroly-za-rok-2019/ds-5653`,
    label: "Kontroly 2019",
    contentType: "decision",
  },
  {
    url: `${BASE_URL}/kontroly-za-rok-2021/ds-6737/archiv=0&p1=1277&rd=1000`,
    label: "Kontroly 2021",
    contentType: "decision",
  },
  // Rozhodnutí předsedy Úřadu (chairman appeal decisions)
  {
    url: `${BASE_URL}/rozhodnuti-predsedy-uradu/ds-3815/p1=3815`,
    label: "Rozhodnutí předsedy Úřadu",
    contentType: "decision",
  },
  // Druhoinstanční rozhodnutí (second-instance decisions)
  {
    url: `${BASE_URL}/druhoinstancni-rozhodnuti-predsedkyne-uoou-o-prestupku/ds-5774/archiv=0&p1=1625`,
    label: "Druhoinstanční rozhodnutí",
    contentType: "decision",
  },
  // Přestupky — obchodní sdělení (commercial messaging violations)
  {
    url: `${BASE_URL}/hlavni-menu/ds-1253/archiv=0&p1=1493&rd=1000`,
    label: "Přestupky — obchodní sdělení",
    contentType: "decision",
  },
];

/** Guideline listing seeds — methodological guides, opinions, statements. */
const GUIDELINE_SEEDS: SeedConfig[] = [
  // Jiná vyjádření Úřadu (Office statements)
  {
    url: `${BASE_URL}/jina-vyjadreni-uradu/ds-1020`,
    label: "Jiná vyjádření Úřadu",
    contentType: "guideline",
  },
  // Zveřejněné metodiky (published methodologies)
  {
    url: `${BASE_URL}/zverejnene-metodiky/d-28765/p1=4744`,
    label: "Zveřejněné metodiky",
    contentType: "guideline",
  },
  // Cookies FAQ / guidance
  {
    url: `${BASE_URL}/casto-kladene-otazky-ohledne-souhlasu-s-cookies-udeleneho-prostrednictvim-tzv-cookie-listy/ds-6912/archiv=1&p1=2619`,
    label: "Cookies — často kladené otázky",
    contentType: "guideline",
  },
  // Standardní smluvní doložky (standard contractual clauses)
  {
    url: `${BASE_URL}/standardni-smluvni-dolozky/ds-5074/p1=5074`,
    label: "Standardní smluvní doložky",
    contentType: "guideline",
  },
  // EDPB schválené pokyny (approved EDPB guidelines — Czech translations)
  {
    url: `${BASE_URL}/schvalene-pokyny/d-28603`,
    label: "Schválené pokyny EDPB",
    contentType: "guideline",
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeedConfig {
  url: string;
  label: string;
  contentType: "decision" | "guideline";
}

interface CrawledLink {
  url: string;
  title: string;
  seedLabel: string;
  contentType: "decision" | "guideline";
}

interface ParsedDecision {
  reference: string;
  title: string;
  date: string | null;
  type: string;
  entity_name: string | null;
  fine_amount: number | null;
  summary: string;
  full_text: string;
  topics: string;
  gdpr_articles: string;
  status: string;
}

interface ParsedGuideline {
  reference: string | null;
  title: string;
  date: string | null;
  type: string;
  summary: string;
  full_text: string;
  topics: string;
  language: string;
}

interface CrawlStats {
  pages_fetched: number;
  decisions_inserted: number;
  decisions_skipped: number;
  guidelines_inserted: number;
  guidelines_skipped: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// HTTP fetch with retry
// ---------------------------------------------------------------------------

async function fetchPage(url: string, attempt = 1): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "cs,en;q=0.5",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    return await res.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * attempt;
      console.warn(
        `  [retry ${attempt}/${MAX_RETRIES}] ${url} — ${msg} — waiting ${delay}ms`,
      );
      await sleep(delay);
      return fetchPage(url, attempt + 1);
    }
    throw new Error(`Failed after ${MAX_RETRIES} attempts: ${url} — ${msg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Link extraction — listing pages
// ---------------------------------------------------------------------------

/**
 * Extract detail-page links from a ÚOOÚ listing page.
 *
 * ÚOOÚ listing pages use a consistent pattern: each item is either in a
 * <div class="dok"> block with an <a> tag, or in a list (<ul>/<ol>) of links
 * inside the main content area. Links point to detail pages on the same domain.
 */
function extractLinks(html: string, seed: SeedConfig): CrawledLink[] {
  const $ = cheerio.load(html);
  const links: CrawledLink[] = [];
  const seen = new Set<string>();

  // The main content area on uoou.cz is typically within #stred or .dok-anotace
  // or the general content divs. We look broadly but filter to internal links.
  const selectors = [
    "#stred a[href]",
    ".dok a[href]",
    ".dok-anotace a[href]",
    ".obsah a[href]",
    ".list a[href]",
    "#content a[href]",
    "div.ui a[href]",
    ".vismo_article a[href]",
    // Fallback: any anchor in the main body
    "main a[href]",
    "#main a[href]",
    "article a[href]",
  ];

  for (const selector of selectors) {
    $(selector).each((_i, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();

      if (!href || !text) return;

      const resolved = resolveUrl(href);
      if (!resolved) return;

      // Skip navigation, category, and non-content links
      if (isNavigationLink(resolved)) return;

      // Deduplicate
      const canonical = canonicalizeUrl(resolved);
      if (seen.has(canonical)) return;
      seen.add(canonical);

      links.push({
        url: resolved,
        title: text,
        seedLabel: seed.label,
        contentType: seed.contentType,
      });
    });
  }

  return links;
}

/** Resolve relative href to absolute URL on uoou.cz. */
function resolveUrl(href: string): string | null {
  const trimmed = href.trim();

  // Skip anchors, javascript, mailto, tel
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  ) {
    return null;
  }

  // External links
  if (trimmed.startsWith("http") && !trimmed.includes("uoou.cz")) {
    return null;
  }

  // Absolute on same domain
  if (trimmed.startsWith("http")) {
    return trimmed;
  }

  // Relative
  if (trimmed.startsWith("/")) {
    return `${BASE_URL}${trimmed}`;
  }

  return `${BASE_URL}/${trimmed}`;
}

/** Strip pagination and archive params for deduplication. */
function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Keep path + essential params, discard pagination noise
    u.searchParams.delete("rd");
    return u.toString();
  } catch {
    return url;
  }
}

/** Return true for links that are navigation, RSS, sitemap, or non-content. */
function isNavigationLink(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("/mapa-stranek") ||
    lower.includes("/rss") ||
    lower.includes("/hledani") ||
    lower.includes("/en/") ||
    lower.includes("id_org=200156") || // English-version CMS IDs
    lower.includes(".pdf") ||
    lower.includes(".doc") ||
    lower.includes(".xls") ||
    lower.includes(".zip") ||
    lower.endsWith(".xml") ||
    // Category-only links (ds-XXXX without detail indicator)
    /\/ds-\d+\/?$/.test(lower)
  );
}

// ---------------------------------------------------------------------------
// Pagination — follow "další" (next) links
// ---------------------------------------------------------------------------

/**
 * Extract the URL of the next page from a ÚOOÚ listing, if present.
 *
 * ÚOOÚ uses "další" (next) links for pagination, typically within a
 * .strankovani or .pager container.
 */
function extractNextPage(html: string): string | null {
  const $ = cheerio.load(html);

  // Look for "další" or "»" links in paging areas
  const pagingSelectors = [
    ".strankovani a",
    ".pager a",
    ".stranka a",
    ".pagination a",
    "nav a",
  ];

  for (const selector of pagingSelectors) {
    const found = $(selector)
      .filter((_i, el) => {
        const text = $(el).text().trim().toLowerCase();
        return text === "další" || text === "»" || text === "next" || text === "›";
      })
      .first();

    if (found.length) {
      const href = found.attr("href");
      if (href) {
        return resolveUrl(href);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Detail-page parsing — decisions
// ---------------------------------------------------------------------------

/** Czech month names → numeric month. */
const CZ_MONTHS: Record<string, string> = {
  ledna: "01",
  února: "02",
  března: "03",
  dubna: "04",
  května: "05",
  června: "06",
  července: "07",
  srpna: "08",
  září: "09",
  října: "10",
  listopadu: "11",
  prosince: "12",
  leden: "01",
  únor: "02",
  březen: "03",
  duben: "04",
  květen: "05",
  červen: "06",
  červenec: "07",
  srpen: "08",
  "září ": "09",
  říjen: "10",
  listopad: "11",
  prosinec: "12",
};

/**
 * Parse a Czech date string into YYYY-MM-DD.
 *
 * Handles formats like:
 *   "5. října 2022", "05.10.2022", "2022-10-05", "říjen 2022"
 */
function parseCzechDate(raw: string): string | null {
  const trimmed = raw.trim();

  // ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // DD.MM.YYYY or D.M.YYYY
  const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, d, m, y] = dotMatch;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }

  // "D. mesice YYYY" — e.g. "5. října 2022"
  const longMatch = trimmed.match(/^(\d{1,2})\.\s*(\S+)\s+(\d{4})$/);
  if (longMatch) {
    const [, d, monthName, y] = longMatch;
    const m = CZ_MONTHS[monthName!.toLowerCase()];
    if (m) {
      return `${y}-${m}-${d!.padStart(2, "0")}`;
    }
  }

  // "mesic YYYY" — e.g. "říjen 2022" → first day of month
  const monthYearMatch = trimmed.match(/^(\S+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const [, monthName, y] = monthYearMatch;
    const m = CZ_MONTHS[monthName!.toLowerCase()];
    if (m) {
      return `${y}-${m}-01`;
    }
  }

  // Bare year
  const yearMatch = trimmed.match(/^(\d{4})$/);
  if (yearMatch) {
    return `${yearMatch[1]}-01-01`;
  }

  return null;
}

/**
 * Detect decision type from title and content.
 *
 * Types: sanction, reprimand, decision, inspection, appeal_decision
 */
function detectDecisionType(title: string, text: string): string {
  const combined = `${title} ${text}`.toLowerCase();

  if (combined.includes("pokut") || combined.includes("sankc")) return "sanction";
  if (combined.includes("napomenutí") || combined.includes("napomíná")) return "reprimand";
  if (
    combined.includes("druhoinstanční") ||
    combined.includes("rozhodnutí předsed")
  )
    return "appeal_decision";
  if (combined.includes("kontrol")) return "inspection";

  return "decision";
}

/**
 * Detect the entity name from the page title or first paragraph.
 *
 * ÚOOÚ titles often follow patterns like:
 *   "Kontrola ... (Název entity)"
 *   "Společnost XYZ s.r.o."
 */
function extractEntityName(title: string, text: string): string | null {
  // Check for entity in parentheses at end of title
  const parenMatch = title.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const candidate = parenMatch[1]!.trim();
    // Filter out generic descriptions
    if (
      candidate.length > 3 &&
      !candidate.toLowerCase().startsWith("čl.") &&
      !candidate.toLowerCase().startsWith("§")
    ) {
      return candidate;
    }
  }

  // Look for "Společnost X" pattern
  const spolMatch = (title + " " + text).match(
    /[Ss]polečnost\s+([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][\w.,\s]+(?:s\.r\.o\.|a\.s\.|spol\.|z\.s\.))/,
  );
  if (spolMatch) return spolMatch[1]!.trim();

  return null;
}

/**
 * Extract a fine amount from text. Looks for patterns like:
 *   "pokuta 2 500 000 Kč", "pokuta ve výši 350.000,- Kč", "pokut 180000 Kč"
 */
function extractFineAmount(text: string): number | null {
  // "pokut[ua] ... XXX Kč" patterns
  const finePatterns = [
    /pokut[auy]?\s+(?:ve výši\s+)?(\d[\d\s.,]*)\s*(?:,-\s*)?Kč/gi,
    /uložil[ao]?\s+(?:pokutu\s+)?(\d[\d\s.,]*)\s*(?:,-\s*)?Kč/gi,
    /(\d[\d\s.,]*)\s*(?:,-\s*)?Kč\s*(?:pokut|sankc)/gi,
  ];

  for (const pattern of finePatterns) {
    const match = pattern.exec(text);
    if (match) {
      const raw = match[1]!
        .replace(/\s/g, "")
        .replace(/\./g, "")
        .replace(/,-$/, "")
        .replace(/,/g, ".");
      const amount = parseFloat(raw);
      if (!isNaN(amount) && amount > 0) return amount;
    }
  }

  // EUR amounts: "XX XXX EUR"
  const eurMatch = text.match(/(\d[\d\s.,]*)\s*(?:,-\s*)?(?:EUR|eur|€)/);
  if (eurMatch) {
    const raw = eurMatch[1]!
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(/,/g, ".");
    const amount = parseFloat(raw);
    // Convert EUR to CZK approximately (for storage; original text preserved)
    if (!isNaN(amount) && amount > 0) return amount;
  }

  return null;
}

/**
 * Detect GDPR articles mentioned in text.
 *
 * Looks for "čl. N", "článek N", "článku N", "čl. N odst. M", "Art. N".
 */
function extractGdprArticles(text: string): string[] {
  const articles = new Set<string>();
  const patterns = [
    /(?:čl\.|článe?k|článku)\s*(\d{1,3})/gi,
    /[Aa]rt(?:icle|\.)\s*(\d{1,3})/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const num = parseInt(match[1]!, 10);
      // GDPR has articles 1-99
      if (num >= 1 && num <= 99) {
        articles.add(String(num));
      }
    }
  }

  return [...articles].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

/**
 * Detect data-protection topics from text content.
 *
 * Maps Czech keywords to our controlled vocabulary topic IDs.
 */
function detectTopics(text: string): string[] {
  const lower = text.toLowerCase();
  const topics: string[] = [];

  const TOPIC_KEYWORDS: Record<string, string[]> = {
    consent: ["souhlas", "souhlasu", "consent", "oprávněný zájem"],
    cookies: ["cookie", "sledovac", "tracker", "e-privacy"],
    transfers: [
      "předávání",
      "třetí zem",
      "mezinárodní organizac",
      "transfer",
      "adequacy",
    ],
    dpia: ["posouzení vlivu", "dpia", "impact assessment", "vysoké riziko"],
    breach_notification: [
      "porušení zabezpečení",
      "data breach",
      "únik dat",
      "bezpečnostní incident",
      "oznámení o porušení",
    ],
    privacy_by_design: [
      "ochrana od návrhu",
      "privacy by design",
      "minimalizace",
      "technická opatření",
    ],
    cctv: ["kamer", "cctv", "video", "sledování", "monitoring"],
    health_data: [
      "zdravotn",
      "zdravotní údaj",
      "zvláštní kategori",
      "citlivé údaje",
      "lék",
    ],
    children: ["dět", "nezletil", "child", "minor"],
  };

  for (const [topicId, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      topics.push(topicId);
    }
  }

  return topics;
}

/** Generate a stable reference from a URL when no explicit reference is found. */
function referenceFromUrl(url: string): string {
  // Extract the document/page ID from ÚOOÚ URL patterns
  // e.g. /d-27287/p1=4967 → "UOOU-d27287-p4967"
  const dMatch = url.match(/\/d-(\d+)/);
  const pMatch = url.match(/p1=(\d+)/);
  const dsMatch = url.match(/\/ds-(\d+)/);

  const parts = ["UOOU"];
  if (dMatch) parts.push(`d${dMatch[1]}`);
  if (dsMatch && !dMatch) parts.push(`ds${dsMatch[1]}`);
  if (pMatch) parts.push(`p${pMatch[1]}`);

  if (parts.length === 1) {
    // Fallback: hash the URL path
    const path = new URL(url).pathname.replace(/\//g, "-").replace(/^-|-$/g, "");
    parts.push(path.slice(0, 60));
  }

  return parts.join("-");
}

/** Extract an explicit reference number from text, e.g. "UOOU-00350/22-28". */
function extractReference(text: string): string | null {
  const patterns = [
    /(?:ÚOOÚ|UOOU|Úřad[^.]*?č\.\s*j\.)\s*[-:]?\s*(UOOU-[\d/]+-\d+)/i,
    /(UOOU-[\d/]+-\d+)/i,
    /č\.\s*j\.\s*:?\s*([\w-]+\/\d+-\d+)/i,
    /sp\.\s*zn\.\s*:?\s*([\w-]+\/\d+-\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1]!.trim();
  }

  return null;
}

/**
 * Parse a ÚOOÚ detail page into a decision record.
 */
function parseDecisionPage(
  html: string,
  link: CrawledLink,
): ParsedDecision | null {
  const $ = cheerio.load(html);

  // Main content — ÚOOÚ uses various containers
  const contentSelectors = [
    "#stred .obsah",
    "#stred .dok",
    "#stred",
    ".vismo_detail",
    "#content",
    "article",
    "main",
  ];

  let contentEl: ReturnType<typeof $> | null = null;
  for (const sel of contentSelectors) {
    const found = $(sel);
    if (found.length && found.text().trim().length > 100) {
      contentEl = found;
      break;
    }
  }

  if (!contentEl) {
    console.warn(`  [skip] No content found on ${link.url}`);
    return null;
  }

  // Title: prefer <h1> or <h2>, fall back to link title
  const pageTitle =
    $("h1").first().text().trim() ||
    $("h2").first().text().trim() ||
    link.title;

  // Full text: clean up the content
  const fullText = contentEl
    .text()
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (fullText.length < 50) {
    console.warn(`  [skip] Content too short on ${link.url} (${fullText.length} chars)`);
    return null;
  }

  // Extract structured fields
  const reference = extractReference(fullText) ?? referenceFromUrl(link.url);
  const date = extractDateFromPage($, fullText);
  const type = detectDecisionType(pageTitle, fullText);
  const entityName = extractEntityName(pageTitle, fullText);
  const fineAmount = extractFineAmount(fullText);
  const gdprArticles = extractGdprArticles(fullText);
  const topics = detectTopics(fullText);

  // Summary: first ~500 chars of content, or meta description
  const metaDesc =
    $('meta[name="description"]').attr("content")?.trim() ?? null;
  const summary =
    metaDesc && metaDesc.length > 30
      ? metaDesc
      : fullText.slice(0, 500).replace(/\s\S*$/, "…");

  return {
    reference,
    title: pageTitle,
    date,
    type,
    entity_name: entityName,
    fine_amount: fineAmount,
    summary,
    full_text: fullText,
    topics: JSON.stringify(topics),
    gdpr_articles: JSON.stringify(gdprArticles),
    status: "final",
  };
}

/**
 * Parse a ÚOOÚ detail page into a guideline record.
 */
function parseGuidelinePage(
  html: string,
  link: CrawledLink,
): ParsedGuideline | null {
  const $ = cheerio.load(html);

  const contentSelectors = [
    "#stred .obsah",
    "#stred .dok",
    "#stred",
    ".vismo_detail",
    "#content",
    "article",
    "main",
  ];

  let contentEl: ReturnType<typeof $> | null = null;
  for (const sel of contentSelectors) {
    const found = $(sel);
    if (found.length && found.text().trim().length > 100) {
      contentEl = found;
      break;
    }
  }

  if (!contentEl) {
    console.warn(`  [skip] No content found on ${link.url}`);
    return null;
  }

  const pageTitle =
    $("h1").first().text().trim() ||
    $("h2").first().text().trim() ||
    link.title;

  const fullText = contentEl
    .text()
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (fullText.length < 50) {
    console.warn(`  [skip] Content too short on ${link.url} (${fullText.length} chars)`);
    return null;
  }

  const reference = extractReference(fullText) ?? referenceFromUrl(link.url);
  const date = extractDateFromPage($, fullText);
  const topics = detectTopics(fullText);
  const type = detectGuidelineType(pageTitle, fullText);

  const metaDesc =
    $('meta[name="description"]').attr("content")?.trim() ?? null;
  const summary =
    metaDesc && metaDesc.length > 30
      ? metaDesc
      : fullText.slice(0, 500).replace(/\s\S*$/, "…");

  return {
    reference,
    title: pageTitle,
    date,
    type,
    summary,
    full_text: fullText,
    topics: JSON.stringify(topics),
    language: "cs",
  };
}

/** Detect guideline type from title and content. */
function detectGuidelineType(title: string, text: string): string {
  const combined = `${title} ${text}`.toLowerCase();

  if (combined.includes("metodický pokyn") || combined.includes("metodika"))
    return "guideline";
  if (combined.includes("stanovisk")) return "opinion";
  if (combined.includes("doporučení")) return "recommendation";
  if (combined.includes("vyjádření")) return "statement";
  if (combined.includes("pokyn") || combined.includes("guideline"))
    return "guideline";
  if (combined.includes("faq") || combined.includes("často kladené"))
    return "faq";

  return "guidance";
}

/** Extract a date from the page metadata or body text. */
function extractDateFromPage(
  $: cheerio.CheerioAPI,
  fullText: string,
): string | null {
  // Meta tag dates
  const metaDate =
    $('meta[name="dcterms.created"]').attr("content") ??
    $('meta[name="dcterms.date"]').attr("content") ??
    $('meta[name="date"]').attr("content") ??
    $('meta[property="article:published_time"]').attr("content") ??
    null;

  if (metaDate) {
    const parsed = parseCzechDate(metaDate);
    if (parsed) return parsed;
  }

  // Look for dates in common page elements
  const dateSelectors = [".datum", ".date", ".dok-datum", "time"];
  for (const sel of dateSelectors) {
    const text = $(sel).first().text().trim();
    if (text) {
      const parsed = parseCzechDate(text);
      if (parsed) return parsed;
    }
  }

  // First date-like pattern in text (DD.MM.YYYY)
  const dateInText = fullText.match(/(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/);
  if (dateInText) {
    const cleaned = dateInText[1]!.replace(/\s/g, "");
    const parsed = parseCzechDate(cleaned);
    if (parsed) return parsed;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

function openDb(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (FLAG_FORCE && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log(`[force] Deleted existing database at ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  return db;
}

function getExistingReferences(db: Database.Database): Set<string> {
  const refs = new Set<string>();

  const decisionRefs = db
    .prepare("SELECT reference FROM decisions")
    .all() as Array<{ reference: string }>;
  for (const row of decisionRefs) {
    refs.add(row.reference);
  }

  const guidelineRefs = db
    .prepare("SELECT reference FROM guidelines WHERE reference IS NOT NULL")
    .all() as Array<{ reference: string }>;
  for (const row of guidelineRefs) {
    refs.add(row.reference);
  }

  return refs;
}

function insertDecision(
  db: Database.Database,
  d: ParsedDecision,
): boolean {
  try {
    db.prepare(
      `INSERT OR IGNORE INTO decisions
        (reference, title, date, type, entity_name, fine_amount, summary, full_text, topics, gdpr_articles, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      d.reference,
      d.title,
      d.date,
      d.type,
      d.entity_name,
      d.fine_amount,
      d.summary,
      d.full_text,
      d.topics,
      d.gdpr_articles,
      d.status,
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [db-error] Decision ${d.reference}: ${msg}`);
    return false;
  }
}

function insertGuideline(
  db: Database.Database,
  g: ParsedGuideline,
): boolean {
  try {
    db.prepare(
      `INSERT INTO guidelines
        (reference, title, date, type, summary, full_text, topics, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      g.reference,
      g.title,
      g.date,
      g.type,
      g.summary,
      g.full_text,
      g.topics,
      g.language,
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [db-error] Guideline ${g.reference ?? g.title}: ${msg}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Seed the topics table with the controlled vocabulary
// ---------------------------------------------------------------------------

function seedTopics(db: Database.Database): void {
  const topics = [
    {
      id: "consent",
      name_cs: "Souhlas",
      name_en: "Consent",
      desc: "Získání, platnost a odvolání souhlasu se zpracováním osobních údajů (čl. 7 GDPR).",
    },
    {
      id: "cookies",
      name_cs: "Cookies a sledovací technologie",
      name_en: "Cookies and trackers",
      desc: "Ukládání a čtení cookies a sledovacích technologií na zařízeních uživatelů.",
    },
    {
      id: "transfers",
      name_cs: "Předávání dat do třetích zemí",
      name_en: "International transfers",
      desc: "Předávání osobních údajů do třetích zemí nebo mezinárodním organizacím (čl. 44–49 GDPR).",
    },
    {
      id: "dpia",
      name_cs: "Posouzení vlivu na ochranu osobních údajů (DPIA)",
      name_en: "Data Protection Impact Assessment (DPIA)",
      desc: "Posouzení rizik pro práva a svobody osob při zpracování s vysokým rizikem (čl. 35 GDPR).",
    },
    {
      id: "breach_notification",
      name_cs: "Porušení zabezpečení osobních údajů",
      name_en: "Data breach notification",
      desc: "Oznamování porušení zabezpečení ÚOOÚ a dotčeným osobám (čl. 33–34 GDPR).",
    },
    {
      id: "privacy_by_design",
      name_cs: "Ochrana soukromí od návrhu",
      name_en: "Privacy by design",
      desc: "Zohledňování ochrany osobních údajů od návrhu a standardně (čl. 25 GDPR).",
    },
    {
      id: "cctv",
      name_cs: "Kamerové systémy",
      name_en: "CCTV and video surveillance",
      desc: "Kamerové sledovací systémy v veřejných a soukromých prostorech v souladu s GDPR.",
    },
    {
      id: "health_data",
      name_cs: "Zdravotní údaje",
      name_en: "Health data",
      desc: "Zpracování zdravotních údajů — zvláštní kategorie vyžadující posílené záruky (čl. 9 GDPR).",
    },
    {
      id: "children",
      name_cs: "Údaje dětí",
      name_en: "Children's data",
      desc: "Ochrana osobních údajů dětí, zejména v online službách (čl. 8 GDPR).",
    },
    {
      id: "direct_marketing",
      name_cs: "Přímý marketing",
      name_en: "Direct marketing",
      desc: "Elektronická obchodní sdělení, telemarketing a přímé oslovování zákazníků.",
    },
    {
      id: "employee_data",
      name_cs: "Údaje zaměstnanců",
      name_en: "Employee data",
      desc: "Zpracování osobních údajů zaměstnanců na pracovišti, monitoring, kontrola docházky.",
    },
    {
      id: "public_sector",
      name_cs: "Veřejný sektor",
      name_en: "Public sector",
      desc: "Zpracování osobních údajů orgány veřejné moci a veřejnými institucemi.",
    },
    {
      id: "right_of_access",
      name_cs: "Právo na přístup",
      name_en: "Right of access",
      desc: "Právo subjektu údajů na přístup ke svým osobním údajům (čl. 15 GDPR).",
    },
    {
      id: "data_retention",
      name_cs: "Doba uchování",
      name_en: "Data retention",
      desc: "Stanovení a dodržování lhůt pro uchování osobních údajů.",
    },
    {
      id: "dpo",
      name_cs: "Pověřenec pro ochranu osobních údajů",
      name_en: "Data Protection Officer (DPO)",
      desc: "Jmenování a povinnosti pověřence pro ochranu osobních údajů (čl. 37–39 GDPR).",
    },
  ];

  const stmt = db.prepare(
    "INSERT OR IGNORE INTO topics (id, name_cs, name_en, description) VALUES (?, ?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const t of topics) {
      stmt.run(t.id, t.name_cs, t.name_en, t.desc);
    }
  });
  tx();
}

// ---------------------------------------------------------------------------
// Main crawl loop
// ---------------------------------------------------------------------------

async function crawlSeedPage(
  seed: SeedConfig,
  stats: CrawlStats,
): Promise<CrawledLink[]> {
  const allLinks: CrawledLink[] = [];
  let currentUrl: string | null = seed.url;
  let pageNum = 1;

  while (currentUrl) {
    console.log(`  [page ${pageNum}] ${currentUrl}`);
    await sleep(RATE_MS);

    try {
      const html = await fetchPage(currentUrl);
      stats.pages_fetched++;

      const links = extractLinks(html, seed);
      allLinks.push(...links);
      console.log(`    Found ${links.length} links`);

      currentUrl = extractNextPage(html);
      pageNum++;

      // Safety limit — don't paginate beyond 50 pages per seed
      if (pageNum > 50) {
        console.warn(`    [limit] Stopping pagination at page ${pageNum}`);
        break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [error] Seed page ${currentUrl}: ${msg}`);
      stats.errors++;
      break;
    }
  }

  return allLinks;
}

async function processLink(
  link: CrawledLink,
  db: Database.Database,
  existingRefs: Set<string>,
  stats: CrawlStats,
): Promise<void> {
  await sleep(RATE_MS);

  let html: string;
  try {
    html = await fetchPage(link.url);
    stats.pages_fetched++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [error] ${link.url}: ${msg}`);
    stats.errors++;
    return;
  }

  if (link.contentType === "decision") {
    const parsed = parseDecisionPage(html, link);
    if (!parsed) return;

    if (FLAG_RESUME && existingRefs.has(parsed.reference)) {
      console.log(`  [resume-skip] Decision ${parsed.reference}`);
      stats.decisions_skipped++;
      return;
    }

    if (FLAG_DRY_RUN) {
      console.log(
        `  [dry-run] Decision: ${parsed.reference} | ${parsed.title.slice(0, 60)} | type=${parsed.type} | fine=${parsed.fine_amount ?? "none"}`,
      );
      stats.decisions_inserted++;
      return;
    }

    if (insertDecision(db, parsed)) {
      existingRefs.add(parsed.reference);
      stats.decisions_inserted++;
      console.log(
        `  [+] Decision: ${parsed.reference} — ${parsed.title.slice(0, 60)}`,
      );
    }
  } else {
    const parsed = parseGuidelinePage(html, link);
    if (!parsed) return;

    const ref = parsed.reference ?? parsed.title;
    if (FLAG_RESUME && existingRefs.has(ref)) {
      console.log(`  [resume-skip] Guideline ${ref.slice(0, 60)}`);
      stats.guidelines_skipped++;
      return;
    }

    if (FLAG_DRY_RUN) {
      console.log(
        `  [dry-run] Guideline: ${ref.slice(0, 60)} | type=${parsed.type}`,
      );
      stats.guidelines_inserted++;
      return;
    }

    if (insertGuideline(db, parsed)) {
      if (parsed.reference) existingRefs.add(parsed.reference);
      stats.guidelines_inserted++;
      console.log(
        `  [+] Guideline: ${(parsed.reference ?? parsed.title).slice(0, 60)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  console.log("=== ÚOOÚ Ingestion Crawler ===");
  console.log(`  Database:   ${DB_PATH}`);
  console.log(`  Rate limit: ${RATE_MS}ms`);
  console.log(`  Flags:      ${FLAG_RESUME ? "--resume " : ""}${FLAG_DRY_RUN ? "--dry-run " : ""}${FLAG_FORCE ? "--force " : ""}`);
  console.log();

  // Open database (unless dry-run with force — still need schema for reference check)
  const db = FLAG_DRY_RUN && !existsSync(DB_PATH) ? null : openDb();

  if (db) {
    seedTopics(db);
  }

  const existingRefs = db ? getExistingReferences(db) : new Set<string>();
  if (FLAG_RESUME) {
    console.log(`  Existing references in DB: ${existingRefs.size}`);
  }

  const stats: CrawlStats = {
    pages_fetched: 0,
    decisions_inserted: 0,
    decisions_skipped: 0,
    guidelines_inserted: 0,
    guidelines_skipped: 0,
    errors: 0,
  };

  // Phase 1: Collect links from all seed pages
  console.log("\n--- Phase 1: Collecting links from listing pages ---\n");

  const allLinks: CrawledLink[] = [];
  const allSeeds = [...DECISION_SEEDS, ...GUIDELINE_SEEDS];

  for (const seed of allSeeds) {
    console.log(`\n[seed] ${seed.label}`);
    const links = await crawlSeedPage(seed, stats);
    allLinks.push(...links);
  }

  // Deduplicate links by URL
  const seenUrls = new Set<string>();
  const uniqueLinks = allLinks.filter((link) => {
    const canonical = canonicalizeUrl(link.url);
    if (seenUrls.has(canonical)) return false;
    seenUrls.add(canonical);
    return true;
  });

  console.log(
    `\n--- Phase 2: Processing ${uniqueLinks.length} detail pages (${allLinks.length - uniqueLinks.length} duplicates removed) ---\n`,
  );

  // Phase 2: Fetch and parse each detail page
  for (let i = 0; i < uniqueLinks.length; i++) {
    const link = uniqueLinks[i]!;
    const progress = `[${i + 1}/${uniqueLinks.length}]`;
    console.log(`${progress} ${link.contentType}: ${link.title.slice(0, 70)}`);

    try {
      await processLink(link, db!, existingRefs, stats);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [error] ${link.url}: ${msg}`);
      stats.errors++;
    }
  }

  // Summary
  console.log("\n=== Crawl Complete ===");
  console.log(`  Pages fetched:       ${stats.pages_fetched}`);
  console.log(`  Decisions inserted:  ${stats.decisions_inserted}`);
  console.log(`  Decisions skipped:   ${stats.decisions_skipped}`);
  console.log(`  Guidelines inserted: ${stats.guidelines_inserted}`);
  console.log(`  Guidelines skipped:  ${stats.guidelines_skipped}`);
  console.log(`  Errors:              ${stats.errors}`);

  if (db) {
    const decisionCount = (
      db.prepare("SELECT count(*) as cnt FROM decisions").get() as { cnt: number }
    ).cnt;
    const guidelineCount = (
      db.prepare("SELECT count(*) as cnt FROM guidelines").get() as { cnt: number }
    ).cnt;
    const topicCount = (
      db.prepare("SELECT count(*) as cnt FROM topics").get() as { cnt: number }
    ).cnt;

    console.log(`\n  DB totals:`);
    console.log(`    Topics:     ${topicCount}`);
    console.log(`    Decisions:  ${decisionCount}`);
    console.log(`    Guidelines: ${guidelineCount}`);

    db.close();
  }

  if (FLAG_DRY_RUN) {
    console.log(`\n  [dry-run] No database writes were made.`);
  }

  console.log(`\n  Database at ${DB_PATH}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
