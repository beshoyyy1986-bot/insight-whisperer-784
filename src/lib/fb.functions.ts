import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GRAPH_API_VERSION = "v25.0";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RAW_INPUT_LENGTH = 1_000_000;
const MAX_COOKIE_LENGTH = 32_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const CREATE_AD_MUTATION = "LWICometCreateBoostedComponentMutation";
const CREATE_AD_DOC_ID = "9955578997835249";
const UPLOAD_IMAGE_MUTATION = "LWICometAdAccountUploadImageMutation";
const UPLOAD_IMAGE_DOC_ID = "9778970048838259";

const credsSchema = z.object({
  uid: z.string().regex(/^\d{5,}$/),
  dtsg: z.string().min(10).max(1_000),
  jazoest: z.string().max(100).optional().nullable(),
  lsd: z.string().max(1_000).optional().nullable(),
  av: z
    .string()
    .regex(/^\d{5,}$/)
    .optional()
    .nullable(),
  dynParams: z.record(z.string().max(100), z.string().max(50_000)).optional().nullable(),
  graphqlDocuments: z
    .record(z.string().max(200), z.string().regex(/^\d{6,}$/))
    .optional()
    .nullable(),
  cookieString: z.string().min(1).max(MAX_COOKIE_LENGTH),
});

type Creds = z.infer<typeof credsSchema>;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchWithTimeout(input: string | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function getStringPath(value: unknown, path: string[]) {
  const result = getPath(value, path);
  return typeof result === "string" && result ? result : null;
}

function stripWrappingQuotes(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readRequestValue(text: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lineMatch = text.match(new RegExp(`(?:^|\\n)${escaped}(?:\\t+|[ ]{2,}|\\n)([^\\n]+)`));
  if (lineMatch?.[1]) return stripWrappingQuotes(lineMatch[1]);

  const keyValueMatch = text.match(new RegExp(`(?:^|[?&\\s])${escaped}=([^&'"\\s]+)`));
  if (keyValueMatch?.[1]) {
    try {
      return decodeURIComponent(stripWrappingQuotes(keyValueMatch[1]));
    } catch {
      return stripWrappingQuotes(keyValueMatch[1]);
    }
  }
  return null;
}

function extractGraphqlDocuments(text: string) {
  const documents: Record<string, string> = {};
  const friendlyNamePattern =
    /fb_api_req_friendly_name(?:\t+|[ ]{2,}|\n|=)["']?([A-Za-z0-9_]+)["']?/g;
  const matches = [...text.matchAll(friendlyNamePattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const friendlyName = match[1];
    if (!friendlyName) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? Math.min(text.length, start + 100_000);
    const block = text.slice(start, end);
    const docId = readRequestValue(block, "doc_id");
    if (docId && /^\d{6,}$/.test(docId)) documents[friendlyName] = docId;
  }

  return Object.keys(documents).length ? documents : null;
}

function baseParams(c: Creds) {
  const p: Record<string, string> = {
    av: c.av ?? c.uid,
    __user: c.uid,
    __a: "1",
    __req: "a",
    dpr: "1",
    __ccg: "GOOD",
    __comet_req: "11",
    fb_dtsg: c.dtsg,
    fb_api_caller_class: "RelayModern",
    server_timestamps: "true",
  };
  // Live session params captured from a real request paste (authoritative)
  if (c.dynParams) {
    for (const [k, v] of Object.entries(c.dynParams)) {
      if (k && v && k !== "fb_dtsg" && k !== "av" && k !== "__user") p[k] = v;
    }
  }
  if (c.jazoest) p["jazoest"] = c.jazoest;
  if (c.lsd) p["lsd"] = c.lsd;
  return p;
}

function fbHeaders(c: Creds, friendlyName?: string) {
  const h: Record<string, string> = {
    cookie: c.cookieString,
    "user-agent": UA,
    "x-fb-lsd": c.lsd ?? "",
    "x-asbd-id": "129477",
    "x-fb-friendly-name": friendlyName ?? "",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "accept-language": "en-US,en;q=0.9",
    origin: "https://www.facebook.com",
    referer: "https://www.facebook.com/adsmanager/manage/campaigns",
  };
  return h;
}

function parseFbResponse(text: string) {
  const content = text.replace(/^for \(;;\);/, "");
  let result: Record<string, unknown> = {};
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object") {
        result = { ...result, ...obj };
      }
    } catch {
      /* ignore non-json chunks */
    }
  }
  return result;
}

function summarizeProviderError(text: string) {
  const parsed = parseFbResponse(text);
  const providerError = getPath(parsed, ["errors"]) ?? getPath(parsed, ["error"]);
  if (providerError) return JSON.stringify(providerError).slice(0, 500);
  return `استجابة غير متوقعة من Meta (${text.length} حرف).`;
}

// ─── Universal input parser ────────────────────────────────────────────────
// Accepts: raw cookie string, curl command, HTTP request paste, JSON, or
// any blob that happens to contain the tokens we need. Returns whatever we
// can identify. Nothing is required.
export function parseAnyInput(raw: string): {
  cookieString: string | null;
  uid: string | null;
  dtsg: string | null;
  lsd: string | null;
  jazoest: string | null;
  av: string | null;
  dynParams: Record<string, string> | null;
  graphqlDocuments: Record<string, string> | null;
  act: string | null;
  pageId: string | null;
  businessId: string | null;
} {
  const out = {
    cookieString: null as string | null,
    uid: null as string | null,
    dtsg: null as string | null,
    lsd: null as string | null,
    jazoest: null as string | null,
    av: null as string | null,
    dynParams: null as Record<string, string> | null,
    graphqlDocuments: null as Record<string, string> | null,
    act: null as string | null,
    pageId: null as string | null,
    businessId: null as string | null,
  };
  if (!raw || !raw.trim()) return out;

  const text = raw.trim().slice(0, MAX_RAW_INPUT_LENGTH).replace(/\r\n?/g, "\n");

  // 1) Try to find a Cookie: header inside a curl/HTTP paste
  const cookieHeaderRe =
    /(?:^|\n|\s|-H\s*['"]|--header\s*['"]|-b\s*['"])[Cc]ookie:\s*([^'"\n\r]+)['"]?/;
  const cookieHeaderMatch = text.match(cookieHeaderRe);
  let cookieRaw = cookieHeaderMatch?.[1] ?? null;

  // 2) If no explicit header, use the whole input if it looks like cookies (contains c_user=)
  if (!cookieRaw && /(^|[;\s])c_user=/.test(text)) {
    cookieRaw = text;
  }

  if (cookieRaw) {
    // Normalize separators
    const normalized = cookieRaw
      .replace(/[\r\n]+/g, ";")
      .replace(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]*=)/g, ";");
    const map: Record<string, string> = {};
    for (const part of normalized.split(";")) {
      const t = part.trim();
      if (!t) continue;
      const i = t.indexOf("=");
      if (i > 0) {
        const k = t.slice(0, i).trim();
        const v = t
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (k && v && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(k)) map[k] = v;
      }
    }
    if (Object.keys(map).length) {
      const essential = [
        "c_user",
        "xs",
        "fr",
        "datr",
        "sb",
        "dpr",
        "wd",
        "locale",
        "presence",
        "ps_l",
        "ps_n",
      ];
      const parts: string[] = [];
      for (const k of essential) if (map[k]) parts.push(`${k}=${map[k]}`);
      for (const [k, v] of Object.entries(map)) if (!essential.includes(k)) parts.push(`${k}=${v}`);
      out.cookieString = parts.join("; ");
      if (map["c_user"]) out.uid = map["c_user"];
      if (map["fb_dtsg"]) out.dtsg = map["fb_dtsg"];
      if (map["lsd"]) out.lsd = map["lsd"];
    }
  }

  // 3) Scan the raw text for tokens (works for HTML pastes, JSON pastes, curl bodies)
  if (!out.dtsg) {
    const requestDtsg = readRequestValue(text, "fb_dtsg");
    if (requestDtsg) out.dtsg = requestDtsg;
  }
  if (!out.dtsg) {
    const dtsgPatterns: RegExp[] = [
      /"dtsg"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"/,
      /\\"dtsg\\":\{\\"token\\":\\"([^"\\]+)\\"/,
      /"token"\s*:\s*"(NAc[^"\\]{10,})"/,
      /name=\\?"fb_dtsg\\?"\s+value=\\?"([^"\\]+)\\?"/,
      /fb_dtsg["'\s:=]+([A-Za-z0-9:_\-%]{20,})/,
      /(?:^|\n)fb_dtsg\n([A-Za-z0-9:_\-%]{20,})/,
      /DTSGInitialData[^}]*"token"\s*:\s*"([^"]+)"/,
      /"dtsg_token"\s*:\s*"([^"]+)"/,
      /--data-raw\s+['"][^'"]*fb_dtsg=([^&'"\s]+)/,
      /&fb_dtsg=([^&'"\s]+)/,
      /\bfb_dtsg=([A-Za-z0-9:_\-%]+)/,
    ];
    for (const re of dtsgPatterns) {
      const m = text.match(re);
      if (m?.[1]) {
        out.dtsg = decodeURIComponent(m[1].replace(/\\\//g, "/"));
        break;
      }
    }
  }

  if (!out.lsd) {
    const requestLsd = readRequestValue(text, "lsd");
    if (requestLsd) out.lsd = requestLsd;
  }
  if (!out.lsd) {
    const lsdPatterns: RegExp[] = [
      /"LSD"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/,
      /\\"LSD\\",\[\],\{\\"token\\":\\"([^"\\]+)\\"/,
      /name=\\?"lsd\\?"\s+value=\\?"([^"\\]+)\\?"/,
      /"lsd"\s*:\s*\{"token"\s*:\s*"([^"]+)"/,
      /-H\s+['"]x-fb-lsd:\s*([^'"\s]+)/i,
      /\blsd=([A-Za-z0-9_-]+)/,
      /(?:^|\n)lsd\n([A-Za-z0-9_-]+)/,
    ];
    for (const re of lsdPatterns) {
      const m = text.match(re);
      if (m?.[1]) {
        out.lsd = m[1];
        break;
      }
    }
  }

  if (!out.uid) {
    const requestUid = readRequestValue(text, "__user");
    if (requestUid && /^\d{5,}$/.test(requestUid)) out.uid = requestUid;
  }
  if (!out.uid) {
    const uidPatterns: RegExp[] = [
      /"USER_ID"\s*:\s*"(\d{5,})"/,
      /"actorID"\s*:\s*"(\d{5,})"/,
      /"viewer_id"\s*:\s*"(\d{5,})"/,
      /\bc_user=(\d{5,})/,
      /\b__user=(\d{5,})/,
      /(?:^|\n)__user\n(\d{5,})/,
      /"uid"\s*:\s*"?(\d{5,})/,
    ];
    for (const re of uidPatterns) {
      const m = text.match(re);
      if (m?.[1]) {
        out.uid = m[1];
        break;
      }
    }
  }

  if (!out.jazoest) {
    const requestJazoest = readRequestValue(text, "jazoest");
    if (requestJazoest) out.jazoest = requestJazoest;
  }
  if (!out.jazoest && out.dtsg) {
    out.jazoest = "2" + [...out.dtsg].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString();
  }

  // 4) IDs from URLs
  const actMatch = text.match(/act=(\d{5,})/);
  if (actMatch?.[1]) out.act = actMatch[1];
  if (!out.act) {
    const accountMatch =
      text.match(/"legacy_ad_account_id"\s*:\s*"?(\d{6,})/) ??
      text.match(/"ad_account"\s*:\s*\{[^{}]{0,500}"id"\s*:\s*"?(\d{6,})/) ??
      text.match(/(?:^|\n)ad_account\s+\{[^{}\n]{0,500}\bid\s*[:\t]\s*"?(\d{6,})/);
    if (accountMatch?.[1]) out.act = accountMatch[1];
  }
  const pageMatch =
    text.match(/[?&]page_id=(\d{5,})/) ||
    text.match(/facebook\.com\/(\d{5,})(?:[/?#]|$)/) ||
    text.match(/"page_id"\s*:\s*"?(\d{5,})/);
  if (pageMatch?.[1]) out.pageId = pageMatch[1];
  const bizMatch =
    text.match(/[?&]business_id=(\d{5,})/) || text.match(/"business_id"\s*:\s*"?(\d{5,})/);
  if (bizMatch?.[1]) out.businessId = bizMatch[1];
  if (!out.businessId) {
    const requestBusinessId = readRequestValue(text, "__bid");
    if (requestBusinessId && /^\d{5,}$/.test(requestBusinessId)) {
      out.businessId = requestBusinessId;
    }
  }

  // 5) Capture the actor id (av) — differs from c_user when acting as a page/business
  const avMatch =
    (readRequestValue(text, "av")?.match(/^(\d{5,})$/) ?? null) ||
    text.match(/[?&\s]av=(\d{5,})/) ||
    text.match(/"av"\s*:\s*"?(\d{5,})/);
  if (avMatch?.[1]) out.av = avMatch[1];

  // 6) Capture live session params from a pasted GraphQL request payload
  //    (form-field dumps like "name\nvalue" lines, or name=value pairs).
  //    These (__s, __dyn, __csr, __hsdp, __hblp, __sjsp, __hsi, __spin_*, __req, __rev, __ccg)
  //    are request-scoped; replaying them verbatim is what makes Meta accept the upload.
  const dynKeys = [
    "__req",
    "__s",
    "__hsi",
    "__dyn",
    "__csr",
    "__hsdp",
    "__hblp",
    "__sjsp",
    "__spin_r",
    "__spin_b",
    "__spin_t",
    "__jssesw",
    "__rev",
    "__ccg",
    "__aaid",
    "_callFlowletID",
    "_triggerFlowletID",
  ];
  const dyn: Record<string, string> = {};
  for (const key of dynKeys) {
    const value = readRequestValue(text, key);
    if (value) dyn[key] = value;
  }
  if (Object.keys(dyn).length) out.dynParams = dyn;
  out.graphqlDocuments = extractGraphqlDocuments(text);

  return out;
}

function extractFromHtml(html: string) {
  const parsed = parseAnyInput(html);
  return { dtsg: parsed.dtsg, lsd: parsed.lsd };
}

export const parseInput = createServerFn({ method: "POST" })
  .validator((d) => z.object({ raw: z.string().min(1).max(MAX_RAW_INPUT_LENGTH) }).parse(d))
  .handler(async ({ data }) => parseAnyInput(data.raw));

export const fetchSessionTokens = createServerFn({ method: "POST" })
  .validator((d) =>
    z
      .object({
        cookieString: z.string().min(1).max(MAX_COOKIE_LENGTH),
        uid: z
          .string()
          .regex(/^\d{5,}$/)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const browserHeaders: Record<string, string> = {
      cookie: data.cookieString,
      "user-agent": UA,
      "accept-language": "en-US,en;q=0.9",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "upgrade-insecure-requests": "1",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    };
    const pages = [
      // mbasic serves plain HTML with hidden <input name="fb_dtsg"> — easiest to parse
      "https://mbasic.facebook.com/",
      "https://mbasic.facebook.com/settings",
      "https://m.facebook.com/",
      "https://m.facebook.com/settings",
      "https://www.facebook.com/ads/manager/account_settings/information/",
      "https://www.facebook.com/business_center/",
      "https://www.facebook.com/me",
      "https://www.facebook.com/settings",
      "https://web.facebook.com/settings",
    ];
    let lastLen = 0;
    let lastStatus = 0;
    let redirectedToLogin = false;
    for (const url of pages) {
      try {
        const res = await fetchWithTimeout(url, { headers: browserHeaders, redirect: "follow" });
        lastStatus = res.status;
        if (res.redirected && /login|checkpoint/.test(res.url)) redirectedToLogin = true;
        const html = await res.text();
        lastLen = html.length;
        const { dtsg, lsd } = extractFromHtml(html);
        if (dtsg) {
          const jazoest = "2" + [...dtsg].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString();
          return { success: true, dtsg, lsd, jazoest, error: null };
        }
      } catch {
        /* try next */
      }
    }
    const hint = redirectedToLogin
      ? "فيسبوك حوّل الطلب لصفحة تسجيل الدخول — الكوكيز غير صالحة أو ناقصة (لازم c_user و xs كاملين)."
      : "فيسبوك لم يُرجع الصفحة الكاملة لطلب السيرفر. انسخ fb_dtsg يدوياً: افتح فيسبوك، اضغط F12 ← Console واكتب require('DTSG').getToken() أو الصق مصدر الصفحة (Ctrl+U) هنا.";
    return {
      success: false,
      dtsg: null,
      lsd: null,
      jazoest: null,
      error: `تعذّر استخراج fb_dtsg تلقائياً (HTTP ${lastStatus}، ${lastLen} حرف). ${hint}`,
    };
  });

function extractAccessToken(html: string): string | null {
  if (!html) return null;
  const patterns: RegExp[] = [
    /window\.adAccountTokens\s*=\s*\{[^}]*"(\d+)"\s*:\s*"(EAA[A-Za-z0-9_-]+)"/,
    /"accessToken"\s*:\s*"(EAA[A-Za-z0-9_-]+)"/,
    /\\"accessToken\\":\\"(EAA[A-Za-z0-9_-]+)\\"/,
    /"access_token"\s*:\s*"(EAA[A-Za-z0-9_-]+)"/,
    /accessToken\s*[:=]\s*["'](EAA[A-Za-z0-9_-]+)["']/,
    /(EAA[A-Za-z0-9_-]{40,})/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    const token = (m?.[2] ?? m?.[1]) as string | undefined;
    if (token && token.startsWith("EAA") && token.length >= 40) return token;
  }
  return null;
}

async function fetchAccessTokenFromSession(
  cookieString: string,
): Promise<{ token: string | null; debug: string }> {
  const headers: Record<string, string> = {
    cookie: cookieString,
    "user-agent": UA,
    "accept-language": "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "upgrade-insecure-requests": "1",
  };
  const urls = [
    "https://adsmanager.facebook.com/adsmanager/manage/campaigns",
    "https://business.facebook.com/adsmanager/manage/campaigns",
    "https://www.facebook.com/adsmanager/manage/campaigns",
    "https://business.facebook.com/latest/home",
    "https://www.facebook.com/ads/manager/account_settings/information/",
  ];
  const notes: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { headers, redirect: "follow" });
      const html = await res.text();
      const token = extractAccessToken(html);
      const redirected = res.redirected && /login|checkpoint/i.test(res.url);
      notes.push(`${new URL(url).host} ${res.status}/${html.length}${redirected ? " →login" : ""}`);
      if (token) return { token, debug: notes.join(" | ") };
    } catch (error: unknown) {
      notes.push(`${url}: ${errorMessage(error).slice(0, 60)}`);
    }
  }
  return { token: null, debug: notes.join(" | ") };
}

// Scrape accounts/pages directly from Facebook HTML using cookies.
// Graph API tokens scraped from adsmanager are ad-account-scoped and fail on /me/*,
// so we parse account and page metadata out of authenticated HTML pages instead.

async function fetchHtml(
  url: string,
  cookieString: string,
): Promise<{ status: number; html: string; finalUrl: string }> {
  const res = await fetchWithTimeout(url, {
    headers: {
      cookie: cookieString,
      "user-agent": UA,
      "accept-language": "en-US,en;q=0.9",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "upgrade-insecure-requests": "1",
    },
    redirect: "follow",
  });
  const html = await res.text();
  return { status: res.status, html, finalUrl: res.url };
}

function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    if (!seen.has(x.id)) {
      seen.add(x.id);
      out.push(x);
    }
  }
  return out;
}

// Decode common escape forms found in Facebook HTML/JSON dumps.
function decodeFbString(s: string): string {
  let out = s;
  try {
    out = out.replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    out = out.replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  } catch {
    /* ignore */
  }
  return out.trim();
}

// Scan an HTML/JSON blob for compact objects and return them as small dicts.
// We only care about a handful of keys, so we regex them out per-object.
function* iterJsonObjects(html: string): Generator<Record<string, string>> {
  const objRe = /\{[^{}]{0,4000}\}/g;
  const keyRe = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(\d+))/g;
  for (const m of html.matchAll(objRe)) {
    const body = m[0];
    const d: Record<string, string> = {};
    for (const k of body.matchAll(keyRe)) {
      const key = k[1]!;
      const val = k[2] !== undefined ? k[2]! : k[3]!;
      if (!(key in d)) d[key] = val;
    }
    if (Object.keys(d).length) yield d;
  }
}

export const fetchAdAccounts = createServerFn({ method: "POST" })
  .validator((d) => z.object({ cookieString: z.string().min(1).max(MAX_COOKIE_LENGTH) }).parse(d))
  .handler(async ({ data }) => {
    const notes: string[] = [];
    const map = new Map<string, { id: string; name: string; currency: string; status: number }>();

    const addAcct = (id: string, name?: string, currency?: string) => {
      if (!/^\d{6,}$/.test(id)) return;
      const prev = map.get(id);
      const cleanName = name ? decodeFbString(name) : "";
      map.set(id, {
        id,
        name: cleanName || prev?.name || `Ad Account ${id}`,
        currency: (currency || prev?.currency || "USD").toUpperCase(),
        status: 1,
      });
    };

    // 1) Graph API attempt
    try {
      const tok = await fetchAccessTokenFromSession(data.cookieString);
      notes.push(`token:${tok.token ? "yes" : "no"}`);
      if (tok.token) {
        const gr = await fetchWithTimeout(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/me/adaccounts?fields=name,account_id,currency,account_status&limit=500`,
          { headers: { authorization: `Bearer ${tok.token}` } },
        );
        const gj = (await gr.json()) as {
          data?: { account_id?: string; name?: string; currency?: string }[];
          error?: { code?: number; message?: string };
        };
        if (Array.isArray(gj?.data)) {
          for (const a of gj.data)
            if (a.account_id) addAcct(String(a.account_id), a.name, a.currency);
          notes.push(`graph:${gj.data.length}`);
        } else if (gj?.error) {
          notes.push(`graph_err:${gj.error.code}/${(gj.error.message || "").slice(0, 40)}`);
        }
      }
    } catch (error: unknown) {
      notes.push(`graph_ex:${errorMessage(error).slice(0, 40)}`);
    }

    // 2) Scrape multiple HTML sources — Business settings pages list everything.
    const urls = [
      "https://business.facebook.com/settings/ad-accounts",
      "https://business.facebook.com/billing_hub/accounts",
      "https://business.facebook.com/adsmanager/manage/accounts",
      "https://adsmanager.facebook.com/adsmanager/manage/accounts",
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns",
      "https://www.facebook.com/adsmanager/manage/campaigns",
    ];
    for (const url of urls) {
      try {
        const { status, html, finalUrl } = await fetchHtml(url, data.cookieString);
        const redirected = /login|checkpoint/i.test(finalUrl);
        notes.push(`${new URL(url).host} ${status}/${html.length}${redirected ? " →login" : ""}`);
        if (redirected) continue;

        // Walk JSON objects and pick ones that look like ad accounts.
        for (const o of iterJsonObjects(html)) {
          const id =
            o["account_id"] || o["accountID"] || o["adAccountID"] || o["legacy_ad_account_id"];
          const name = o["name"] || o["account_name"];
          const curr = o["currency"];
          if (id && /^\d{6,}$/.test(id)) addAcct(id, name, curr);
        }
        // Catch bare act_XXX references too.
        for (const m of html.matchAll(/act[_=](\d{6,})/g)) if (m[1]) addAcct(m[1]);
      } catch (error: unknown) {
        notes.push(`scrape_ex:${errorMessage(error).slice(0, 40)}`);
      }
    }

    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (list.length === 0) {
      return {
        success: false,
        accounts: list,
        error: `لم نعثر على أي حساب إعلاني. تأكد أن الكوكيز صالحة وتحتوي c_user و xs. (${notes.join(" | ")})`,
      };
    }
    return { success: true, accounts: list, error: null };
  });

export const fetchPages = createServerFn({ method: "POST" })
  .validator((d) => z.object({ cookieString: z.string().min(1).max(MAX_COOKIE_LENGTH) }).parse(d))
  .handler(async ({ data }) => {
    const notes: string[] = [];
    const map = new Map<string, { id: string; name: string; accessToken: string | null }>();

    const addPage = (id: string, name?: string, token?: string | null) => {
      if (!/^\d{6,}$/.test(id)) return;
      const prev = map.get(id);
      const cleanName = name ? decodeFbString(name) : "";
      map.set(id, {
        id,
        name: cleanName || prev?.name || `Page ${id}`,
        accessToken: token ?? prev?.accessToken ?? null,
      });
    };

    // 1) Graph API attempt.
    try {
      const tok = await fetchAccessTokenFromSession(data.cookieString);
      notes.push(`token:${tok.token ? "yes" : "no"}`);
      if (tok.token) {
        const gr = await fetchWithTimeout(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts?fields=name,id,access_token&limit=200`,
          { headers: { authorization: `Bearer ${tok.token}` } },
        );
        const gj = (await gr.json()) as {
          data?: { id?: string; name?: string; access_token?: string }[];
          error?: { code?: number; message?: string };
        };
        if (Array.isArray(gj?.data)) {
          for (const p of gj.data) if (p.id) addPage(String(p.id), p.name, p.access_token ?? null);
          notes.push(`graph:${gj.data.length}`);
        } else if (gj?.error) {
          notes.push(`graph_err:${gj.error.code}/${(gj.error.message || "").slice(0, 40)}`);
        }
      }
    } catch (error: unknown) {
      notes.push(`graph_ex:${errorMessage(error).slice(0, 40)}`);
    }

    // 2) HTML scraping — business settings + mbasic list.
    const urls = [
      "https://business.facebook.com/settings/pages",
      "https://www.facebook.com/pages/?category=your_pages",
      "https://www.facebook.com/bookmarks/pages",
      "https://mbasic.facebook.com/pages/?category=your_pages",
      "https://mbasic.facebook.com/profile.php?v=admin_pages",
    ];
    for (const url of urls) {
      try {
        const { status, html, finalUrl } = await fetchHtml(url, data.cookieString);
        const redirected = /login|checkpoint/i.test(finalUrl);
        notes.push(`${new URL(url).host} ${status}/${html.length}${redirected ? " →login" : ""}`);
        if (redirected) continue;

        // JSON objects that look like pages.
        for (const o of iterJsonObjects(html)) {
          const id =
            o["page_id"] ||
            o["pageID"] ||
            (o["id"] && (o["name"] || o["page_name"]) ? o["id"] : "");
          const name = o["name"] || o["page_name"];
          if (id && /^\d{6,}$/.test(id) && name) addPage(id, name);
        }

        // mbasic anchors: <a href="/pages/Name/12345">Page Name</a>
        for (const m of html.matchAll(
          /<a[^>]+href="[^"]*\/pages\/[^"/]+\/(\d{6,})[^"]*"[^>]*>([^<]{1,80})<\/a>/g,
        )) {
          if (m[1] && m[2]) addPage(m[1], m[2]);
        }
        // Generic anchors with page id at the tail
        for (const m of html.matchAll(
          /<a[^>]+href="[^"]*[?&]id=(\d{9,})[^"]*"[^>]*>([^<]{1,80})<\/a>/g,
        )) {
          if (m[1] && m[2]) addPage(m[1], m[2]);
        }
      } catch (error: unknown) {
        notes.push(`scrape_ex:${errorMessage(error).slice(0, 40)}`);
      }
    }

    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (list.length === 0) {
      return {
        success: false,
        pages: list,
        error: `لم نعثر على أي صفحة. تأكد أن الكوكيز صالحة. (${notes.join(" | ")})`,
      };
    }
    return { success: true, pages: list, error: null };
  });

type BrowserAccount = { id: string; name: string; currency: string; status: number };
type BrowserPage = { id: string; name: string };
type BrowserBusiness = { id: string; name: string };

function toBrowserCookies(cookieString: string) {
  const cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax";
  }[] = [];
  for (const part of cookieString.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || !value || value.length > 8_000) continue;
    cookies.push({
      name,
      value,
      domain: ".facebook.com",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    });
  }
  return cookies;
}

async function graphAssetsFromToken(token: string) {
  async function collection<T>(path: string, fields: string, limit: number): Promise<T[]> {
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("limit", String(limit));
    const response = await fetchWithTimeout(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as {
      data?: T[];
      error?: { code?: number };
    };
    if (!response.ok || body.error) return [];
    return Array.isArray(body.data) ? body.data : [];
  }

  const [rawAccounts, rawPages, rawBusinesses] = await Promise.all([
    collection<{
      account_id?: string;
      name?: string;
      currency?: string;
      account_status?: number;
    }>("me/adaccounts", "account_id,name,currency,account_status", 500),
    collection<{ id?: string; name?: string }>("me/accounts", "id,name", 200),
    collection<{ id?: string; name?: string }>("me/businesses", "id,name", 100),
  ]);

  return {
    accounts: rawAccounts
      .filter((account) => /^\d+$/.test(account.account_id ?? ""))
      .map((account) => ({
        id: account.account_id!,
        name: account.name?.trim() || `Ad Account ${account.account_id}`,
        currency: account.currency?.toUpperCase() || "USD",
        status: account.account_status ?? 0,
      })),
    pages: rawPages
      .filter((page) => /^\d+$/.test(page.id ?? ""))
      .map((page) => ({ id: page.id!, name: page.name?.trim() || `Page ${page.id}` })),
    businesses: rawBusinesses
      .filter((business) => /^\d+$/.test(business.id ?? ""))
      .map((business) => ({
        id: business.id!,
        name: business.name?.trim() || `Business ${business.id}`,
      })),
  };
}

// Node-hosted compatibility path: open fixed Meta Business pages in an
// ephemeral browser context using caller-provided cookies. The context is
// always destroyed and the discovered access token never leaves the server.
export const discoverMetaWithPlaywright = createServerFn({ method: "POST" })
  .validator((d) => z.object({ raw: z.string().min(1).max(MAX_RAW_INPUT_LENGTH) }).parse(d))
  .handler(async ({ data }) => {
    const parsed = parseAnyInput(data.raw);
    const cookieString = parsed.cookieString;
    const uid = parsed.uid;
    if (!cookieString || !uid) {
      return {
        success: false as const,
        uid: null,
        dtsg: null,
        lsd: null,
        jazoest: null,
        accounts: [] as BrowserAccount[],
        pages: [] as BrowserPage[],
        businesses: [] as BrowserBusiness[],
        error: "الكوكيز يجب أن تحتوي c_user وxs صالحين.",
      };
    }

    const cookies = toBrowserCookies(cookieString);
    if (!cookies.some((cookie) => cookie.name === "xs")) {
      return {
        success: false as const,
        uid,
        dtsg: null,
        lsd: null,
        jazoest: null,
        accounts: [] as BrowserAccount[],
        pages: [] as BrowserPage[],
        businesses: [] as BrowserBusiness[],
        error: "كوكيز xs غير موجودة؛ لا يمكن فتح جلسة Meta المصادق عليها.",
      };
    }

    let browser: Awaited<ReturnType<(typeof import("playwright"))["chromium"]["launch"]>> | null =
      null;
    try {
      const moduleName = "playwright";
      const { chromium } = await import(/* @vite-ignore */ moduleName);
      const launchedBrowser = await chromium.launch({
        headless: true,
        executablePath: process.env["PLAYWRIGHT_EXECUTABLE_PATH"]?.trim() || undefined,
        timeout: 20_000,
        args: ["--disable-dev-shm-usage", "--no-sandbox"],
      });
      browser = launchedBrowser;
      const context = await launchedBrowser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
        userAgent: UA,
        locale: "en-US",
      });
      await context.addCookies(cookies);
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(25_000);
      page.setDefaultTimeout(12_000);
      await page.route(
        /\.(?:png|jpe?g|gif|webp|svg|woff2?|mp4)(?:\?|$)/i,
        (route: import("playwright").Route) => route.abort(),
      );

      const fixedUrls = [
        "https://business.facebook.com/latest/home",
        "https://adsmanager.facebook.com/adsmanager/manage/campaigns",
        "https://business.facebook.com/settings/ad-accounts",
        "https://business.facebook.com/settings/pages",
      ];
      const htmlParts: string[] = [];
      let dtsg = parsed.dtsg;
      let lsd = parsed.lsd;
      let redirectedToLogin = false;

      for (const url of fixedUrls) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded" });
          if (/login|checkpoint/i.test(page.url())) {
            redirectedToLogin = true;
            break;
          }
          const html = await page.content();
          htmlParts.push(html.slice(0, 5_000_000));
          const htmlTokens = extractFromHtml(html);
          dtsg ||= htmlTokens.dtsg;
          lsd ||= htmlTokens.lsd;
          if (!dtsg) {
            dtsg = await page
              .evaluate(() => {
                const runtime = globalThis as typeof globalThis & {
                  require?: (name: string) => { getToken?: () => string };
                };
                try {
                  return runtime.require?.("DTSG")?.getToken?.() ?? null;
                } catch {
                  return null;
                }
              })
              .catch(() => null);
          }
        } catch {
          // Continue to the next fixed Meta page; one surface can be unavailable.
        }
      }

      const combinedHtml = htmlParts.join("\n");
      const accessToken = extractAccessToken(combinedHtml);
      const accountMap = new Map<string, BrowserAccount>();
      const pageMap = new Map<string, BrowserPage>();
      const businessMap = new Map<string, BrowserBusiness>();

      for (const object of iterJsonObjects(combinedHtml)) {
        const accountId =
          object["account_id"] ||
          object["accountID"] ||
          object["adAccountID"] ||
          object["legacy_ad_account_id"];
        if (accountId && /^\d{6,}$/.test(accountId)) {
          accountMap.set(accountId, {
            id: accountId,
            name:
              decodeFbString(object["name"] || object["account_name"] || "") ||
              `Ad Account ${accountId}`,
            currency: (object["currency"] || "USD").toUpperCase(),
            status: Number(object["account_status"] || 0),
          });
        }
        const pageId = object["page_id"] || object["pageID"];
        if (pageId && /^\d{6,}$/.test(pageId)) {
          pageMap.set(pageId, {
            id: pageId,
            name: decodeFbString(object["page_name"] || object["name"] || "") || `Page ${pageId}`,
          });
        }
        const businessId = object["business_id"] || object["businessID"];
        if (businessId && /^\d{6,}$/.test(businessId)) {
          businessMap.set(businessId, {
            id: businessId,
            name:
              decodeFbString(object["business_name"] || object["name"] || "") ||
              `Business ${businessId}`,
          });
        }
      }

      if (accessToken) {
        const graphAssets = await graphAssetsFromToken(accessToken);
        for (const account of graphAssets.accounts) accountMap.set(account.id, account);
        for (const metaPage of graphAssets.pages) pageMap.set(metaPage.id, metaPage);
        for (const business of graphAssets.businesses) businessMap.set(business.id, business);
      }

      await context.close();
      const accounts = [...accountMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      const pages = [...pageMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      const businesses = [...businessMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      const jazoest = dtsg
        ? "2" + [...dtsg].reduce((sum, character) => sum + character.charCodeAt(0), 0)
        : parsed.jazoest;

      if (redirectedToLogin) {
        return {
          success: false as const,
          uid,
          dtsg: null,
          lsd: null,
          jazoest: null,
          accounts: [],
          pages: [],
          businesses: [],
          error: "Meta حوّل المتصفح إلى تسجيل الدخول أو checkpoint؛ حدّث كوكيز c_user وxs.",
        };
      }
      return {
        success: Boolean(dtsg || accounts.length || pages.length),
        uid,
        dtsg: dtsg ?? null,
        lsd: lsd ?? null,
        jazoest: jazoest ?? null,
        accounts,
        pages,
        businesses,
        error:
          dtsg || accounts.length || pages.length
            ? null
            : "تم فتح Meta Business لكن لم تظهر بيانات أصول في الصفحات المتاحة للحساب.",
      };
    } catch (error) {
      const message = errorMessage(error);
      const missingBrowser =
        /Executable doesn't exist|browserType\.launch|Cannot find module/i.test(message);
      return {
        success: false as const,
        uid,
        dtsg: null,
        lsd: null,
        jazoest: null,
        accounts: [] as BrowserAccount[],
        pages: [] as BrowserPage[],
        businesses: [] as BrowserBusiness[],
        error: missingBrowser
          ? "Chromium الخاص بـPlaywright غير مثبت على خادم Node. شغّل npx playwright install chromium أثناء إعداد الخادم."
          : `تعذّر تشغيل جلسة Playwright: ${message.slice(0, 180)}`,
      };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  });

export const uploadImage = createServerFn({ method: "POST" })
  .validator((d) =>
    z
      .object({
        credentials: credsSchema,
        adAccountId: z.string().regex(/^(?:act_)?\d{6,}$/),
        fileName: z.string().min(1).max(255),
        fileType: z.enum(["image/jpeg", "image/png"]),
        fileBase64: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4),
        width: z.number().int().min(1).max(20_000).default(1200),
        height: z.number().int().min(1).max(20_000).default(628),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const c = data.credentials;
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data.fileBase64), (character) => character.charCodeAt(0));
    } catch {
      return { success: false, imageHash: null, error: "بيانات الصورة ليست Base64 صالحة." };
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { success: false, imageHash: null, error: "حجم الصورة يتجاوز الحد الأقصى (12MB)." };
    }
    const mime = data.fileType;
    const actNoPrefix = data.adAccountId.replace(/^act_/, "");
    const adAccountId = actNoPrefix;

    const extractHash = (parsed: unknown): string | null => {
      if (!parsed) return null;
      // GraphQL shapes
      const g1 = getStringPath(parsed, ["data", "ad_account_upload_image", "image", "image_hash"]);
      const g2 = getStringPath(parsed, ["data", "adAccountUploadImage", "image", "image_hash"]);
      if (g1) return g1;
      if (g2) return g2;
      // Graph API /adimages shape: { images: { filename: { hash: "..." } } }
      const images = asRecord(asRecord(parsed)?.["images"]);
      if (images) {
        for (const image of Object.values(images)) {
          const hash = asRecord(image)?.["hash"];
          if (typeof hash === "string" && hash) return hash;
        }
      }
      return null;
    };

    const attempts: { name: string; status: number; body: string }[] = [];

    // Attempt 1: Official Graph API with access token extracted from adsmanager
    try {
      const adsmanagerRes = await fetchWithTimeout(
        "https://adsmanager.facebook.com/adsmanager/manage/campaigns",
        {
          headers: {
            cookie: c.cookieString,
            "user-agent": UA,
            "accept-language": "en-US,en;q=0.9",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
        },
      );
      const html = await adsmanagerRes.text();
      const token = extractAccessToken(html);
      if (token) {
        // Safe base64 encoding without spread argument limits
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const base64 = btoa(binary);
        const form = new FormData();
        form.append("bytes", base64);
        const graphRes = await fetchWithTimeout(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${actNoPrefix}/adimages`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            body: form,
          },
        );
        const graphText = await graphRes.text();
        let graphJson: unknown = null;
        try {
          graphJson = JSON.parse(graphText);
        } catch {
          /* ignore */
        }
        const hash = extractHash(graphJson);
        if (hash) return { success: true, imageHash: hash, error: null };
        attempts.push({
          name: "graph-api",
          status: graphRes.status,
          body: summarizeProviderError(graphText),
        });
      } else {
        attempts.push({ name: "graph-api", status: 0, body: "No access token in adsmanager HTML" });
      }
    } catch (error: unknown) {
      attempts.push({ name: "graph-api", status: 0, body: errorMessage(error) });
    }

    // Attempt 2: GraphQL LWICometAdAccountUploadImageMutation
    try {
      const form = new FormData();
      const params: Record<string, string> = {
        ...baseParams(c),
        fb_api_req_friendly_name: UPLOAD_IMAGE_MUTATION,
        __crn: "comet.bizweb.BizWebCometLWIConsolidatedProductCreationRoute",
        variables: JSON.stringify({
          input: {
            ad_account_id: adAccountId,
            hide_in_ad_image_library: false,
            actor_id: c.av ?? c.uid,
            client_mutation_id: "1",
          },
          imageWidth: Math.max(1, Math.round(data.width)),
          imageHeight: Math.max(1, Math.round(data.height)),
        }),
        doc_id: c.graphqlDocuments?.[UPLOAD_IMAGE_MUTATION] ?? UPLOAD_IMAGE_DOC_ID,
      };
      for (const [k, v] of Object.entries(params)) form.append(k, v);
      const fileBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      form.append("file", new Blob([fileBuffer], { type: mime }), data.fileName);
      const res = await fetchWithTimeout("https://www.facebook.com/api/graphql/", {
        method: "POST",
        headers: fbHeaders(c, UPLOAD_IMAGE_MUTATION),
        body: form,
      });
      const text = await res.text();
      const parsed = parseFbResponse(text);
      const hash = extractHash(parsed);
      if (hash) return { success: true, imageHash: hash, error: null };
      attempts.push({
        name: "graphql",
        status: res.status,
        body: summarizeProviderError(text),
      });
    } catch (error: unknown) {
      attempts.push({ name: "graphql", status: 0, body: errorMessage(error) });
    }

    const summary = attempts
      .map((a) => `[${a.name} ${a.status}] ${a.body}`)
      .join(" | ")
      .slice(0, 800);
    return {
      success: false,
      imageHash: null,
      error: `فشلت كل محاولات الرفع. ${summary}`,
    };
  });

export const createAd = createServerFn({ method: "POST" })
  .validator((d) =>
    z
      .object({
        credentials: credsSchema,
        act: z.string().regex(/^(?:act_)?\d{6,}$/),
        pageId: z.string().regex(/^\d{6,}$/),
        targetId: z
          .string()
          .regex(/^\d{6,}$/)
          .nullable()
          .optional(),
        destinationUrl: z
          .string()
          .url()
          .max(2_000)
          .refine((url) => /^https?:\/\//i.test(url), "destinationUrl must use HTTP or HTTPS")
          .nullable()
          .optional(),
        country: z.string().regex(/^[A-Z]{2}$/),
        currency: z.string().regex(/^[A-Z]{3}$/),
        gender: z.enum(["0", "1", "2"]),
        ageMin: z.number().int().min(18).max(65),
        ageMax: z.number().int().min(18).max(65),
        savedAudienceId: z
          .string()
          .regex(/^\d{6,}$/)
          .nullable()
          .optional(),
        goal: z.enum(["1", "2", "3", "4"]),
        budget: z.number().finite().positive().max(1_000_000),
        continuous: z.boolean(),
        days: z.number().int().min(-1).max(365),
        message: z.string().max(5_000),
        storeName: z.string().max(255).nullable().optional(),
        imageHashes: z.array(z.string().min(6).max(500)).min(1).max(10),
      })
      .superRefine((value, context) => {
        if (value.ageMin > value.ageMax) {
          context.addIssue({
            code: "custom",
            path: ["ageMax"],
            message: "ageMax must be greater than or equal to ageMin",
          });
        }
        if (!value.continuous && value.days < 1) {
          context.addIssue({
            code: "custom",
            path: ["days"],
            message: "days must be at least 1 for a fixed-duration ad",
          });
        }
        if (value.goal === "4" && !value.destinationUrl) {
          context.addIssue({
            code: "custom",
            path: ["destinationUrl"],
            message: "destinationUrl is required for website traffic ads",
          });
        }
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const c = data.credentials;

    const targetingObj: Record<string, unknown> = {
      genders: data.gender === "0" ? [0] : [Number(data.gender)],
      age_min: data.ageMin,
      age_max: data.ageMax,
      targeting_optimization: "expansion_all",
      targeting_automation: { advantage_audience: 1 },
      user_age_unknown: true,
      geo_locations: { countries: [data.country], location_types: ["home", "recent"] },
    };
    const targetingSpecString = JSON.stringify(targetingObj);
    const audienceOption = data.savedAudienceId ? "SAVED_AUDIENCE" : "AUTO_TARGETING";

    const goalMap: Record<string, [string, string, unknown, string[]]> = {
      "1": [
        "POST_ENGAGEMENT",
        "POST_ENGAGEMENT",
        { type: "LIKE_PAGE", value: { page: data.pageId } },
        [],
      ],
      "2": [
        "GET_PAGE_LIKES",
        "PAGE_LIKES",
        { type: "LIKE_PAGE", value: { page: data.pageId } },
        [],
      ],
      "3": [
        "GET_MULTI_MESSAGES",
        "MESSAGES",
        { type: "MESSAGE_PAGE", value: { app_destination: "MESSENGER" } },
        ["FACEBOOK", "MESSENGER"],
      ],
      "4": ["GET_WEBSITE_VISITORS", "WEBSITE_TRAFFIC", null, []],
    };
    const [adsGoal, objective, ctaObj, publisherPlatforms] = goalMap[data.goal] ?? goalMap["4"]!;

    const link = data.destinationUrl ?? `https://facebook.com/${data.pageId}`;
    const linkData: Record<string, unknown> = {
      call_to_action: ctaObj,
      link,
      message: data.message,
    };
    if (data.storeName) linkData["name"] = data.storeName;
    if (data.imageHashes.length > 1) {
      linkData["child_attachments"] = data.imageHashes.map((h) => ({
        link,
        image_hash: h,
        name: data.storeName,
      }));
      linkData["multi_share_end_card"] = false;
      linkData["multi_share_optimized"] = true;
    } else {
      linkData["image_hash"] = data.imageHashes[0];
    }

    const creationSpec = {
      ab_test_audiences: [
        {
          audience_option: audienceOption,
          saved_audience_id: data.savedAudienceId ?? null,
          targeting_spec_string: targetingSpecString,
        },
      ],
      ads_lwi_goal: adsGoal,
      audience_option: audienceOption,
      billing_event: "IMPRESSIONS",
      budget: data.budget,
      budget_type: "DAILY_BUDGET",
      currency: data.currency,
      duration_in_days: data.continuous ? -1 : data.days,
      impression_id: crypto.randomUUID(),
      legacy_ad_account_id: data.act,
      legacy_entry_point: "business_content_manager_list_view",
      link_data: linkData,
      placement_spec: { publisher_platforms: publisherPlatforms },
      objective,
      regulated_category: "NONE",
      run_continuously: data.continuous,
      sabr_version: "v1_v2",
      saved_audience_id: data.savedAudienceId ?? null,
      start_time: data.continuous ? null : Math.floor((Date.now() + 3600_000) / 1000),
      surface: "BIZ_WEB",
      targeting_spec_string: targetingSpecString,
    };

    const body = new URLSearchParams({
      ...baseParams(c),
      __crn: "comet.bizweb.BizWebCometLWIConsolidatedProductCreationRoute",
      fb_api_req_friendly_name: CREATE_AD_MUTATION,
      variables: JSON.stringify({
        input: {
          boost_id: null,
          creation_spec: creationSpec,
          external_dependent_ent_id: null,
          flow_id: crypto.randomUUID(),
          lwi_asset_id: { id: data.pageId },
          manual_review_requested: false,
          page_id: data.pageId,
          product: "BOOSTED_CONSOLIDATED_PRODUCT",
          target_id: data.targetId ?? data.pageId,
          actor_id: c.av ?? c.uid,
          client_mutation_id: "1",
        },
      }),
      doc_id: c.graphqlDocuments?.[CREATE_AD_MUTATION] ?? CREATE_AD_DOC_ID,
    });

    const res = await fetchWithTimeout("https://www.facebook.com/api/graphql/", {
      method: "POST",
      headers: {
        ...fbHeaders(c, CREATE_AD_MUTATION),
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const parsed = parseFbResponse(await res.text());
    const adId =
      getStringPath(parsed, ["data", "create_boosted_component", "ad", "id"]) ??
      getStringPath(parsed, ["data", "create_boosted_component", "id"]);

    return {
      success: Boolean(adId),
      adId,
      error: adId
        ? null
        : JSON.stringify(
            getPath(parsed, ["errors"]) ??
              getPath(parsed, ["error"]) ??
              "Meta لم تُرجع معرّف الإعلان.",
          ).slice(0, 800),
    };
  });
