/**
 * playwright-upload.server.ts
 *
 * Launches a headless Chromium browser, injects the user's cookies, navigates
 * to Facebook Ads Manager so the real Relay/Comet app fires its first GraphQL
 * request, intercepts that request to harvest ALL live session params
 * (fb_dtsg, lsd, jazoest, av, __user, __dyn, __csr, __s, __hsi, …), then
 * uses those params to make the LWICometAdAccountUploadImageMutation request
 * server-side via plain fetch().
 *
 * This sidesteps the two failure modes:
 *   [graph-api 0] No access token in adsmanager HTML
 *      → adsmanager is a CSR React app; the EAA token is never in the SSR HTML.
 *   [graphql 200] 1357001
 *      → FB rejects Comet requests when the heavy session params (__dyn, __csr,
 *        __s, __hsi, av, …) are missing or stale.
 *
 * Only runs on the server (TanStack Start / Node.js).  Never import this from
 * a browser bundle.
 */

import { chromium } from "playwright";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlaywrightSession {
  fb_dtsg: string;
  lsd: string;
  jazoest: string;
  uid: string;
  /** Acting actor (page / BM / user – whichever FB chose for this request) */
  av: string;
  /** All heavy Comet session params extracted from the live request */
  dynParams: Record<string, string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const UPLOAD_MUTATION = "LWICometAdAccountUploadImageMutation";
const UPLOAD_DOC_ID = "9778970048838259";

/**
 * Keys that carry Comet session state.
 * Replaying them verbatim is what makes FB accept the subsequent request.
 */
export const COMET_DYN_KEYS = [
  "__req",
  "__s",
  "__hsi",
  "__hs",
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
  "__bid",
  "_callFlowletID",
  "_triggerFlowletID",
  "qpl_active_flow_ids",
  "qpl_active_e2e_trace_ids",
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a "name=value; name2=value2" cookie string to the array that
 * Playwright's addCookies() expects.  We inject the same cookies on
 * .facebook.com, .business.facebook.com and adsmanager.facebook.com so
 * that every redirect works without re-authentication.
 */
function parseCookiesForPlaywright(cookieString: string) {
  const domains = [".facebook.com", ".business.facebook.com", "adsmanager.facebook.com"];
  const cookies: { name: string; value: string; domain: string; path: string }[] = [];

  for (const pair of cookieString.split(";")) {
    const trimmed = pair.trim();
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const name = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!name || !value || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) continue;

    for (const domain of domains) {
      cookies.push({ name, value, domain, path: "/" });
    }
  }
  return cookies;
}

/**
 * Parse a URL-encoded body (application/x-www-form-urlencoded).
 * Returns all key-value pairs – both compact text fields and long session blobs.
 */
function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const sp = new URLSearchParams(body);
    for (const [k, v] of sp.entries()) {
      if (k && v) out[k] = v;
    }
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Very lightweight multipart text-field parser.
 * Only reads form fields (Content-Disposition: form-data; name="…"), skips
 * binary file parts.  Used as a fallback when the upload mutation is sent
 * as multipart/form-data so we can still grab fb_dtsg / __user / etc.
 */
function parseMultipartTextFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Match each non-file text part
  const re =
    /Content-Disposition:\s*form-data;\s*name="([^"]+)"\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n$)/gi;
  for (const m of body.matchAll(re)) {
    const key = m[1]!.trim();
    const val = m[2]!.trim();
    // Skip the file field itself (it will be huge / binary)
    if (key === "file") continue;
    if (key && val) out[key] = val;
  }
  return out;
}

/** Build the jazoest checksum from the dtsg token (same formula FB uses). */
function jazoestFor(dtsg: string): string {
  return "2" + [...dtsg].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString();
}

/**
 * Extract an image hash from a parsed FB GraphQL response object.
 * FB returns different shapes depending on the mutation version.
 */
function extractHashFromParsed(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const d = rec["data"] as Record<string, unknown> | undefined;
  if (!d) return null;
  for (const key of ["ad_account_upload_image", "adAccountUploadImage"]) {
    const node = d[key] as Record<string, unknown> | undefined;
    const image = node?.["image"] as Record<string, unknown> | undefined;
    const hash = image?.["image_hash"];
    if (typeof hash === "string" && hash) return hash;
  }
  return null;
}

// ─── Session capture ──────────────────────────────────────────────────────────

/**
 * Launch a headless Chromium, inject the user's FB cookies, load an Ads
 * Manager URL (which triggers real Comet/Relay GraphQL calls), and intercept
 * the first outgoing request to harvest all live session params.
 *
 * Returns the captured session or an error message.
 */
export async function capturePlaywrightSession(
  cookieString: string,
  /** First page to load.  Should be an adsmanager or bizweb URL to ensure
   *  Relay fires quickly and includes the heavy Comet params. */
  seedUrl = "https://business.facebook.com/adsmanager/manage/campaigns",
): Promise<{ session: PlaywrightSession | null; error: string | null }> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      // Avoid single-process on Railway if Chromium supports sandbox-less workers
      "--renderer-process-limit=1",
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent: UA,
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
    });

    const cookies = parseCookiesForPlaywright(cookieString);
    if (cookies.length === 0) {
      return { session: null, error: "لم يتم استخراج أي كوكيز صالحة من النص المُدخل." };
    }
    await context.addCookies(cookies);

    let session: PlaywrightSession | null = null;

    // Intercept every outgoing graphql request before it leaves the browser
    await context.route("**/api/graphql**", async (route) => {
      const req = route.request();
      const body = req.postData() ?? "";

      if (!session) {
        // Try URL-encoded first (most Relay requests use this)
        let params = parseFormBody(body);
        // Fall back to multipart (some upload-adjacent requests)
        if (!params["fb_dtsg"]) params = { ...params, ...parseMultipartTextFields(body) };

        if (params["fb_dtsg"] && params["__user"]) {
          const dynParams: Record<string, string> = {};
          for (const key of COMET_DYN_KEYS) {
            if (params[key]) dynParams[key] = params[key] as string;
          }
          const dtsg = params["fb_dtsg"] as string;
          session = {
            fb_dtsg: dtsg,
            lsd: params["lsd"] ?? "",
            jazoest: params["jazoest"] ?? jazoestFor(dtsg),
            uid: params["__user"]!,
            av: params["av"] || params["__user"]!,
            dynParams,
          };
        }
      }

      // Always pass the request through unchanged
      await route.continue();
    });

    const page = await context.newPage();

    // Load the seed URL.  domcontentloaded is enough – we just need one
    // Relay request to fire, not full JS hydration.
    try {
      await page.goto(seedUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
    } catch {
      /* A navigation timeout is fine; requests may have already fired. */
    }

    // Poll until we capture something or hit 20 s
    const deadline = Date.now() + 20_000;
    while (!session && Date.now() < deadline) {
      await page.waitForTimeout(400);
    }

    // Second attempt with the .com domain if the BM domain gave nothing
    if (!session) {
      try {
        await page.goto("https://www.facebook.com/adsmanager/manage/campaigns", {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
      } catch {
        /* ignore */
      }
      const deadline2 = Date.now() + 12_000;
      while (!session && Date.now() < deadline2) {
        await page.waitForTimeout(400);
      }
    }

    return {
      session,
      error: session
        ? null
        : "لم يتم اعتراض أي طلب GraphQL — الكوكيز قد تكون منتهية الصلاحية أو الجلسة غير متصلة.",
    };
  } catch (err) {
    return {
      session: null,
      error: `خطأ في تشغيل Playwright: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await browser.close();
  }
}

// ─── Image upload ─────────────────────────────────────────────────────────────

/**
 * Upload a raw image file to Facebook's ad image library using a Playwright-
 * captured live session.
 *
 * Steps:
 *   1. capturePlaywrightSession() – harvests all real Comet params from a
 *      live browser navigating to Ads Manager.
 *   2. Fires the LWICometAdAccountUploadImageMutation multipart request
 *      server-side with those params and the real image bytes.
 *   3. Parses the response for the image_hash.
 *
 * Also returns the captured session so the caller can re-use it for the
 * subsequent createAd / boost mutation without opening another browser.
 */
export async function uploadImageViaPlaywright(opts: {
  cookieString: string;
  adAccountId: string; // with or without "act_" prefix
  imageBytes: Uint8Array;
  fileName: string;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  /** Override doc_id if FB updates the mutation. Default: UPLOAD_DOC_ID */
  docId?: string;
}): Promise<{
  success: boolean;
  imageHash: string | null;
  /** Re-usable session for subsequent mutations (e.g. createAd) */
  session: PlaywrightSession | null;
  error: string | null;
}> {
  // ── 1. Capture live session ──────────────────────────────────────────────
  const actNoPrefix = opts.adAccountId.replace(/^act_/, "");
  const seedUrl = `https://business.facebook.com/adsmanager/manage/campaigns?act=${actNoPrefix}`;

  const { session, error: sessionError } = await capturePlaywrightSession(
    opts.cookieString,
    seedUrl,
  );

  if (!session) {
    return {
      success: false,
      imageHash: null,
      session: null,
      error: `Playwright session capture failed: ${sessionError}`,
    };
  }

  // ── 2. Build multipart upload request ────────────────────────────────────
  const docId = opts.docId ?? UPLOAD_DOC_ID;

  const textParams: Record<string, string> = {
    // Core identity
    av: session.av,
    __user: session.uid,
    __a: "1",
    __req: session.dynParams["__req"] ?? "b",
    dpr: "1",
    __ccg: session.dynParams["__ccg"] ?? "GOOD",
    __comet_req: "11",
    // Auth tokens
    fb_dtsg: session.fb_dtsg,
    jazoest: session.jazoest,
    lsd: session.lsd,
    // Relay metadata
    fb_api_caller_class: "RelayModern",
    server_timestamps: "true",
    fb_api_req_friendly_name: UPLOAD_MUTATION,
    __crn: "comet.bizweb.BizWebCometLWIConsolidatedProductCreationRoute",
    // Mutation-specific
    variables: JSON.stringify({
      input: {
        ad_account_id: actNoPrefix,
        hide_in_ad_image_library: false,
        actor_id: session.av,
        client_mutation_id: "2",
      },
      imageWidth: Math.max(1, Math.round(opts.width)),
      imageHeight: Math.max(1, Math.round(opts.height)),
    }),
    doc_id: docId,
  };

  // Append every captured Comet session param that isn't already set above
  for (const [k, v] of Object.entries(session.dynParams)) {
    if (k && v && !(k in textParams)) textParams[k] = v;
  }

  const form = new FormData();
  for (const [k, v] of Object.entries(textParams)) {
    if (v) form.append(k, v);
  }

  // Attach the image file
  const fileBuffer = opts.imageBytes.buffer.slice(
    opts.imageBytes.byteOffset,
    opts.imageBytes.byteOffset + opts.imageBytes.byteLength,
  ) as ArrayBuffer;
  form.append("file", new Blob([fileBuffer], { type: opts.mimeType }), opts.fileName);

  // ── 3. Send the request ──────────────────────────────────────────────────
  try {
    const res = await fetch("https://www.facebook.com/api/graphql/", {
      method: "POST",
      headers: {
        cookie: opts.cookieString,
        "user-agent": UA,
        "x-fb-lsd": session.lsd,
        "x-fb-friendly-name": UPLOAD_MUTATION,
        "x-asbd-id": "129477",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "accept-language": "en-US,en;q=0.9",
        origin: "https://www.facebook.com",
        referer: "https://www.facebook.com/adsmanager/manage/campaigns",
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    const rawText = await res.text();

    // FB wraps GraphQL responses in "for(;;);" – strip it
    const content = rawText.replace(/^for\s*\(;;\);/, "");
    let imageHash: string | null = null;

    // Response may be a single JSON object or newline-delimited JSON chunks
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const hash = extractHashFromParsed(parsed);
        if (hash) {
          imageHash = hash;
          break;
        }
      } catch {
        /* skip non-JSON lines */
      }
    }

    if (imageHash) {
      return { success: true, imageHash, session, error: null };
    }

    // Build a useful error excerpt
    let errorExcerpt = content.slice(0, 600);
    try {
      const firstLine = content.split("\n").find((l) => l.trim());
      if (firstLine) {
        const parsed = JSON.parse(firstLine) as Record<string, unknown>;
        const fbError =
          (parsed["errors"] as unknown) ?? (parsed["error"] as unknown);
        if (fbError) errorExcerpt = JSON.stringify(fbError).slice(0, 400);
      }
    } catch {
      /* use raw excerpt */
    }

    return {
      success: false,
      imageHash: null,
      session,
      error: `Playwright upload (HTTP ${res.status}): ${errorExcerpt}`,
    };
  } catch (err) {
    return {
      success: false,
      imageHash: null,
      session,
      error: `Playwright upload request error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
