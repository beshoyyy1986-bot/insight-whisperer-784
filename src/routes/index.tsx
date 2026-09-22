import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createAd,
  discoverMetaWithPlaywright,
  fetchAdAccounts,
  fetchPages,
  fetchSessionTokens,
  parseInput,
  uploadImage,
} from "@/lib/fb.functions";
import { disconnectMeta, fetchMetaAssets, getMetaConnection } from "@/lib/meta.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JAMAIKA Meta Ads Pro — لوحة إدارة إعلانات ميتا" },
      {
        name: "description",
        content:
          "أداة عربية لاستيراد بيانات الحساب، رفع الصور، وإنشاء إعلانات فيسبوك وإنستجرام من مكان واحد.",
      },
      { property: "og:title", content: "JAMAIKA Meta Ads Pro" },
      {
        property: "og:description",
        content: "استورد بياناتك، ارفع صورك، وأنشئ إعلاناتك على ميتا بواجهة عربية بسيطة.",
      },
    ],
  }),
  component: Index,
});

type Creds = {
  uid: string;
  dtsg: string;
  jazoest?: string | null;
  lsd?: string | null;
  av?: string | null;
  dynParams?: Record<string, string> | null;
  graphqlDocuments?: Record<string, string> | null;
  cookieString: string;
};

type Ids = { act: string; page_id: string; business_id: string };
type MetaConnection = {
  loading: boolean;
  configured: boolean;
  connected: boolean;
  userId: string | null;
  userName: string | null;
  expiresAt: number | null;
};

const COUNTRIES: Record<string, string> = {
  EG: "مصر 🇪🇬",
  SA: "السعودية 🇸🇦",
  AE: "الإمارات 🇦🇪",
  KW: "الكويت 🇰🇼",
  QA: "قطر 🇶🇦",
  BH: "البحرين 🇧🇭",
  OM: "عُمان 🇴🇲",
  IQ: "العراق 🇮🇶",
  JO: "الأردن 🇯🇴",
  LB: "لبنان 🇱🇧",
  MA: "المغرب 🇲🇦",
  DZ: "الجزائر 🇩🇿",
  TN: "تونس 🇹🇳",
  LY: "ليبيا 🇱🇾",
  SD: "السودان 🇸🇩",
};

const GOALS: Record<string, string> = {
  "1": "تفاعل المنشور",
  "2": "إعجابات الصفحة",
  "3": "رسائل",
  "4": "زيارات الموقع",
};

const TABS = [
  { id: "data", label: "📊 البيانات" },
  { id: "images", label: "🖼️ الصور" },
  { id: "ad", label: "🎯 إنشاء إعلان" },
  { id: "stats", label: "📈 الإحصائيات" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Index() {
  const [cookieInput, setCookieInput] = useState("");
  const [creds, setCreds] = useState<Creds | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const [ids, setIds] = useState<Ids>({ act: "", page_id: "", business_id: "" });
  const [accounts, setAccounts] = useState<{ id: string; name: string; currency: string }[]>([]);
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  const [metaConnection, setMetaConnection] = useState<MetaConnection>({
    loading: true,
    configured: false,
    connected: false,
    userId: null,
    userName: null,
    expiresAt: null,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [hashes, setHashes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>("data");
  const fileRef = useRef<HTMLInputElement>(null);

  const [country, setCountry] = useState("EG");
  const [gender, setGender] = useState<"0" | "1" | "2">("0");
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [savedAudienceId, setSavedAudienceId] = useState("");
  const [goal, setGoal] = useState<"1" | "2" | "3" | "4">("1");
  const [budget, setBudget] = useState(10);
  const [continuous, setContinuous] = useState(false);
  const [days, setDays] = useState(7);
  const [message, setMessage] = useState("");
  const [storeName, setStoreName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [adId, setAdId] = useState<string | null>(null);

  const doUpload = useServerFn(uploadImage);
  const doCreate = useServerFn(createAd);
  const doFetchTokens = useServerFn(fetchSessionTokens);
  const doParseInput = useServerFn(parseInput);
  const doFetchAdAccounts = useServerFn(fetchAdAccounts);
  const doFetchPages = useServerFn(fetchPages);
  const doBrowserDiscovery = useServerFn(discoverMetaWithPlaywright);
  const doGetMetaConnection = useServerFn(getMetaConnection);
  const doFetchMetaAssets = useServerFn(fetchMetaAssets);
  const doDisconnectMeta = useServerFn(disconnectMeta);

  const previews = useMemo(
    () => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [files],
  );
  const sessionReady = Boolean(creds?.dtsg && creds.cookieString);

  useEffect(
    () => () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url);
    },
    [previews],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const connection = await doGetMetaConnection();
        if (!active) return;
        setMetaConnection({ loading: false, ...connection });
        if (connection.connected) {
          const assets = await doFetchMetaAssets();
          if (!active) return;
          if (assets.success) {
            setAccounts(assets.accounts);
            setPages(assets.pages);
            setBusinesses(assets.businesses);
            setIds((previous) => ({
              act: previous.act || assets.accounts[0]?.id || "",
              page_id: previous.page_id || assets.pages[0]?.id || "",
              business_id: previous.business_id || assets.businesses[0]?.id || "",
            }));
          }
        }
        const query = new URLSearchParams(window.location.search);
        if (query.get("meta") === "connected") {
          setNotice({ kind: "ok", text: "تم الاتصال بحساب Meta رسميًا وجلب الأصول المتاحة." });
          window.history.replaceState({}, "", window.location.pathname);
        } else if (query.has("meta_error")) {
          const reason = query.get("meta_error");
          setNotice({
            kind: "err",
            text:
              reason === "not_configured"
                ? "إعدادات Meta App غير مكتملة على الخادم."
                : "تعذّر إكمال تسجيل Meta. أعد المحاولة وتأكد من رابط callback والصلاحيات.",
          });
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch {
        if (active) setMetaConnection((previous) => ({ ...previous, loading: false }));
      }
    })();
    return () => {
      active = false;
    };
  }, [doFetchMetaAssets, doGetMetaConnection]);

  async function refreshOfficialAssets(showNotice = true) {
    const assets = await doFetchMetaAssets();
    if (!assets.success) {
      if (showNotice) setNotice({ kind: "err", text: assets.error });
      return;
    }
    setAccounts(assets.accounts);
    setPages(assets.pages);
    setBusinesses(assets.businesses);
    setIds((previous) => ({
      act: previous.act || assets.accounts[0]?.id || "",
      page_id: previous.page_id || assets.pages[0]?.id || "",
      business_id: previous.business_id || assets.businesses[0]?.id || "",
    }));
    if (showNotice) {
      setNotice({
        kind: "ok",
        text: `تم التحديث رسميًا — ${assets.accounts.length} حساب — ${assets.pages.length} صفحة — ${assets.businesses.length} Business`,
      });
    }
  }

  async function runPlaywrightDiscovery() {
    const raw = cookieInput.trim();
    if (!raw) {
      setNotice({ kind: "err", text: "الصق كوكيز c_user وxs أولاً." });
      return;
    }
    setBusy(true);
    setNotice({ kind: "warn", text: "Playwright يفتح Meta Business في جلسة مؤقتة…" });
    try {
      const [result, parsed] = await Promise.all([
        doBrowserDiscovery({ data: { raw } }),
        doParseInput({ data: { raw } }),
      ]);
      if (!result.success || !result.uid || !parsed.cookieString) {
        setNotice({ kind: "err", text: result.error || "تعذّر اكتشاف جلسة Meta." });
        return;
      }
      setCreds({
        uid: result.uid,
        dtsg: result.dtsg ?? "",
        lsd: result.lsd,
        jazoest: result.jazoest,
        av: parsed.av,
        dynParams: parsed.dynParams,
        graphqlDocuments: parsed.graphqlDocuments,
        cookieString: parsed.cookieString,
      });
      setAccounts(result.accounts);
      setPages(result.pages);
      setBusinesses(result.businesses);
      setIds((previous) => ({
        act: previous.act || result.accounts[0]?.id || parsed.act || "",
        page_id: previous.page_id || result.pages[0]?.id || parsed.pageId || "",
        business_id: previous.business_id || result.businesses[0]?.id || parsed.businessId || "",
      }));
      setCookieInput("");
      setNotice({
        kind: result.dtsg ? "ok" : "warn",
        text: `اكتملت جلسة Playwright — ${result.accounts.length} حساب — ${result.pages.length} صفحة — ${result.businesses.length} Business${result.dtsg ? " — DTSG ✓" : " — DTSG غير متوفر"}`,
      });
    } catch (error) {
      setNotice({ kind: "err", text: `فشل Playwright: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function importCookies() {
    const raw = cookieInput.trim();
    if (!raw) {
      setNotice({ kind: "err", text: "الصق الكوكيز أو أمر curl أو رابط مدير الإعلانات أولاً." });
      return;
    }

    setNotice({ kind: "warn", text: "جارٍ تحليل المُدخل واستخراج التوكنات..." });

    // Universal parse (server, to reuse the same logic and avoid client bundle bloat)
    let parsed;
    try {
      parsed = await doParseInput({ data: { raw } });
    } catch (e) {
      setNotice({ kind: "err", text: `فشل تحليل المُدخل: ${String(e)}` });
      return;
    }

    const uid = parsed.uid;
    const cookieString = parsed.cookieString;

    // Auto-fill IDs if the paste contained ads-manager URLs
    if (parsed.act || parsed.pageId || parsed.businessId) {
      setIds((prev) => ({
        act: parsed.act ?? prev.act,
        page_id: parsed.pageId ?? prev.page_id,
        business_id: parsed.businessId ?? prev.business_id,
      }));
    }

    if (!cookieString || !uid) {
      // No cookies in this paste — if we're already connected, treat it as a
      // live-session refresh (e.g. a pasted upload request payload).
      if (creds && (parsed.dtsg || parsed.dynParams || parsed.graphqlDocuments || parsed.av)) {
        const next: Creds = {
          ...creds,
          dtsg: parsed.dtsg ?? creds.dtsg,
          lsd: parsed.lsd ?? creds.lsd ?? null,
          jazoest: parsed.jazoest ?? creds.jazoest ?? null,
          av: parsed.av ?? creds.av ?? null,
          dynParams: parsed.dynParams ?? creds.dynParams ?? null,
          graphqlDocuments: parsed.graphqlDocuments ?? creds.graphqlDocuments ?? null,
        };
        if (parsed.dtsg && !parsed.jazoest) {
          next.jazoest =
            "2" + [...parsed.dtsg].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString();
        }
        setCreds(next);
        setCookieInput("");
        setNotice({
          kind: "ok",
          text: `تم تحديث الجلسة الحية ✓ — av: ${next.av ?? "—"} — معاملات ديناميكية: ${next.dynParams ? Object.keys(next.dynParams).length : 0} — مستندات GraphQL: ${next.graphqlDocuments ? Object.keys(next.graphqlDocuments).length : 0}`,
        });
        return;
      }
      setNotice({
        kind: "err",
        text: "لم نجد كوكيز صالحة (نحتاج c_user على الأقل). الصق الكوكيز كاملة أو أمر curl من DevTools.",
      });
      return;
    }

    let dtsg = parsed.dtsg ?? "";
    let lsd = parsed.lsd ?? null;
    let jazoest = parsed.jazoest ?? null;
    let source = dtsg ? "من المُدخل مباشرة" : "";

    // If dtsg wasn't already in the paste, fetch it from a live FB page
    if (!dtsg) {
      try {
        const r = await doFetchTokens({ data: { cookieString, uid } });
        if (r.success && r.dtsg) {
          dtsg = r.dtsg;
          lsd = r.lsd ?? lsd;
          jazoest = r.jazoest ?? jazoest;
          source = "من الجلسة الحية";
        }
      } catch {
        /* fall through */
      }
    }

    setCreds({
      uid,
      dtsg,
      jazoest,
      lsd,
      av: parsed.av,
      dynParams: parsed.dynParams,
      graphqlDocuments: parsed.graphqlDocuments,
      cookieString,
    });
    setCookieInput("");

    // Fetch ad accounts and pages via Graph API
    try {
      const [accRes, pageRes] = await Promise.all([
        doFetchAdAccounts({ data: { cookieString } }),
        doFetchPages({ data: { cookieString } }),
      ]);
      if (accRes.success && accRes.accounts.length) {
        setAccounts(accRes.accounts);
        setIds((prev) => ({ ...prev, act: prev.act || accRes.accounts[0]!.id }));
      }
      if (pageRes.success && pageRes.pages.length) {
        setPages(pageRes.pages);
        setIds((prev) => ({ ...prev, page_id: prev.page_id || pageRes.pages[0]!.id }));
      }
      const accText = accRes.success
        ? `${accRes.accounts.length} حساب`
        : `حسابات: ${accRes.error ?? "—"}`;
      const pageText = pageRes.success
        ? `${pageRes.pages.length} صفحة`
        : `صفحات: ${pageRes.error ?? "—"}`;
      if (dtsg) {
        setNotice({
          kind: "ok",
          text: `تم الاستيراد ✓ — UID: ${uid} — fb_dtsg ${source} — ${accText} — ${pageText}`,
        });
      } else {
        setNotice({
          kind: "warn",
          text: `تم حفظ الكوكيز لكن fb_dtsg لم يُستخرج تلقائياً. ${accText} — ${pageText}. الصق قيمته يدوياً بالأسفل.`,
        });
      }
    } catch {
      if (dtsg) {
        setNotice({
          kind: "ok",
          text: `تم الاستيراد ✓ — UID: ${uid} — fb_dtsg ${source} — lsd: ${lsd ? "✓" : "—"} — av: ${parsed.av ?? "—"}`,
        });
      } else {
        setNotice({
          kind: "warn",
          text: "تم حفظ الكوكيز لكن fb_dtsg لم يُستخرج تلقائياً. الصق قيمته يدوياً بالأسفل، أو أعد تسجيل الدخول لفيسبوك.",
        });
      }
    }
  }

  function setDtsg(v: string) {
    if (!creds || !v) return;
    const jazoest = "2" + [...v].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString();
    setCreds({ ...creds, dtsg: v, jazoest });
    setNotice({ kind: "ok", text: "تم تحديث fb_dtsg" });
  }

  async function toBase64(file: File) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 8192) {
      bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    }
    return btoa(bin);
  }

  async function readImageSize(file: File): Promise<{ w: number; h: number }> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ w: img.naturalWidth || 1200, h: img.naturalHeight || 628 });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve({ w: 1200, h: 628 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  async function uploadAll() {
    if (!creds || !ids.act || !sessionReady) {
      setNotice({ kind: "err", text: "أكمل بيانات الجلسة واختر الحساب الإعلاني أولاً." });
      return;
    }
    setBusy(true);
    setNotice(null);
    const out: string[] = [];
    const failed: string[] = [];
    try {
      for (const f of files) {
        const { w, h } = await readImageSize(f);
        const res = await doUpload({
          data: {
            credentials: creds,
            adAccountId: ids.act,
            fileName: f.name,
            fileType: f.type,
            fileBase64: await toBase64(f),
            width: w,
            height: h,
          },
        });
        if (res.success && res.imageHash) {
          out.push(res.imageHash);
          // Playwright captured live session params — merge them into creds so
          // createAd reuses them without opening another browser.
          if (res.capturedAv || res.capturedDynParams) {
            setCreds((prev) => {
              if (!prev) return prev;
              const next: typeof prev = {
                ...prev,
                ...(res.capturedAv != null ? { av: res.capturedAv } : {}),
                ...(res.capturedDynParams != null ? { dynParams: res.capturedDynParams } : {}),
              };
              return next;
            });
          }
        } else failed.push(`${f.name}: ${res.error}`);
      }
      setHashes(out);
      if (failed.length) {
        setNotice({
          kind: out.length ? "warn" : "err",
          text: `تم رفع ${out.length} من ${files.length}. ${failed.join(" — ")}`,
        });
      } else if (out.length) {
        setNotice({ kind: "ok", text: `تم رفع ${out.length} صورة بنجاح` });
      }
    } catch (e) {
      setNotice({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function submitAd() {
    if (!creds || !sessionReady) {
      setNotice({ kind: "err", text: "لا يمكن إنشاء الإعلان قبل توفير fb_dtsg صالح." });
      return;
    }
    setBusy(true);
    setNotice(null);
    setAdId(null);
    try {
      const res = await doCreate({
        data: {
          credentials: creds,
          act: ids.act,
          pageId: ids.page_id,
          targetId: targetId || null,
          destinationUrl: destinationUrl || null,
          country,
          currency: accounts.find((account) => account.id === ids.act)?.currency ?? "USD",
          gender,
          ageMin,
          ageMax,
          savedAudienceId: savedAudienceId || null,
          goal,
          budget,
          continuous,
          days: continuous ? -1 : days,
          message,
          storeName: storeName || null,
          imageHashes: hashes,
        },
      });
      if (res.success) {
        setAdId(res.adId);
        setNotice({ kind: "ok", text: "تم إنشاء الإعلان بنجاح" });
      } else {
        setNotice({ kind: "err", text: `فشل إنشاء الإعلان: ${res.error}` });
      }
    } catch (e) {
      setNotice({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  const noticeClass =
    notice?.kind === "ok"
      ? "border-success/40 bg-success/10 text-success"
      : notice?.kind === "warn"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-destructive/40 bg-destructive/10 text-destructive";

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="font-display text-2xl font-black tracking-tight">
              🚀 JAMAIKA <span className="text-primary">Meta Ads Pro</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              لوحة عربية لإدارة إعلانات فيسبوك وإنستجرام
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              sessionReady
                ? "bg-success/15 text-success"
                : creds
                  ? "bg-warning/15 text-warning"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {metaConnection.connected
              ? `Meta OAuth • ${metaConnection.userName ?? metaConnection.userId}`
              : sessionReady
                ? `جلسة متصفح • ${creds?.uid}`
                : creds
                  ? "بيانات الجلسة ناقصة"
                  : "غير متصل"}
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[340px_1fr]">
        <aside className="panel h-fit space-y-4 p-5">
          <h2 className="font-display text-lg font-bold">⚙️ الإعدادات</h2>

          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div>
              <h3 className="text-sm font-bold text-primary">🔒 اتصال Meta الرسمي</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                OAuth هو المسار الأكثر ثباتًا. التوكن يبقى داخل جلسة مشفرة HttpOnly ولا يظهر في
                المتصفح.
              </p>
            </div>
            {metaConnection.loading ? (
              <p className="text-xs text-muted-foreground">جارٍ فحص الاتصال…</p>
            ) : metaConnection.connected ? (
              <>
                <p className="text-xs font-semibold text-success">
                  متصل: {metaConnection.userName ?? metaConnection.userId}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => void refreshOfficialAssets()}
                  >
                    تحديث الأصول
                  </button>
                  <button
                    className="btn-ghost text-xs"
                    onClick={async () => {
                      await doDisconnectMeta();
                      setMetaConnection((previous) => ({
                        ...previous,
                        connected: false,
                        userId: null,
                        userName: null,
                        expiresAt: null,
                      }));
                      setAccounts([]);
                      setPages([]);
                      setBusinesses([]);
                      setNotice({ kind: "ok", text: "تم فصل جلسة Meta الرسمية." });
                    }}
                  >
                    فصل الاتصال
                  </button>
                </div>
              </>
            ) : metaConnection.configured ? (
              <a className="btn-primary block w-full text-center" href="/auth/meta">
                الاتصال بحساب Meta
              </a>
            ) : (
              <p className="text-xs leading-5 text-warning">
                أضف META_APP_ID وMETA_APP_SECRET وMETA_REDIRECT_URI وMETA_SESSION_SECRET لتفعيل
                OAuth.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-primary">🧭 جلسة Playwright بالكوكيز</h3>
            <p className="text-xs leading-6 text-muted-foreground">
              الصق كوكيز <code className="mx-1 rounded bg-input px-1">c_user=...; xs=...</code>، أو
              أمر <code className="rounded bg-input px-1">curl</code> من DevTools. Playwright يحقنها
              في Browser Context مؤقت، ويفتح Meta Business ويجمع الحسابات والصفحات والمعرفات. لا
              تُحفظ الكوكيز على القرص ويُغلق المتصفح بعد الطلب.
              <br />
              💡 المسار اليدوي يظل متاحًا لالتقاط معاملات طلب
              <code className="mx-1 rounded bg-input px-1">graphql</code>
              (Copy as cURL أو payload).
            </p>
            <textarea
              className="field h-32 resize-none font-mono text-xs"
              dir="ltr"
              placeholder={`c_user=100000...; xs=...; fr=...; datr=...\nأو: curl 'https://www.facebook.com/api/graphql/' -H 'cookie: ...' --data-raw '...&fb_dtsg=NAcM...'`}
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn-primary w-full"
                disabled={busy}
                onClick={runPlaywrightDiscovery}
              >
                {busy ? "جارٍ الفتح…" : "فتح عبر Playwright"}
              </button>
              <button className="btn-ghost w-full" disabled={busy} onClick={importCookies}>
                تحليل بدون متصفح
              </button>
            </div>
          </div>

          {creds && (
            <div className="space-y-3 rounded-lg border border-border bg-surface p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">UID</span>
                <span dir="ltr" className="font-mono">
                  {creds.uid}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">DTSG</span>
                <span dir="ltr" className="truncate font-mono">
                  {creds.dtsg ? creds.dtsg.slice(0, 18) + "…" : "غير متوفر"}
                </span>
              </div>
              <Field label="إدخال fb_dtsg يدوياً">
                <input
                  className="field font-mono text-xs"
                  dir="ltr"
                  placeholder="DTSG token"
                  onBlur={(e) => setDtsg(e.target.value.trim())}
                />
              </Field>
              <button
                className="btn-ghost w-full"
                onClick={() => {
                  setCreds(null);
                  setCookieInput("");
                  setAccounts([]);
                  setPages([]);
                  setBusinesses([]);
                  setIds({ act: "", page_id: "", business_id: "" });
                  setFiles([]);
                  setHashes([]);
                  setNotice(null);
                }}
              >
                تسجيل الخروج
              </button>
            </div>
          )}
        </aside>

        <section className="space-y-4">
          {notice && (
            <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${noticeClass}`}>
              {notice.text}
            </div>
          )}

          {!creds && !metaConnection.connected ? (
            <div className="panel p-10 text-center">
              <p className="text-lg font-bold">⚠️ يرجى الاتصال بـMeta أو استيراد الكوكيز للبدء</p>
              <p className="mt-2 text-sm text-muted-foreground">
                استخدم القائمة الجانبية لإضافة بيانات حسابك.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                      tab === t.id
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === "data" && (
                <div className="panel space-y-4 p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold">📊 معرفات الحساب</h2>
                    <button
                      className="btn-ghost text-xs"
                      disabled={!creds && !metaConnection.connected}
                      onClick={async () => {
                        if (metaConnection.connected) {
                          await refreshOfficialAssets();
                          return;
                        }
                        if (!creds) return;
                        setNotice({ kind: "warn", text: "جارٍ تحديث القوائم…" });
                        const [accRes, pageRes] = await Promise.all([
                          doFetchAdAccounts({ data: { cookieString: creds.cookieString } }),
                          doFetchPages({ data: { cookieString: creds.cookieString } }),
                        ]);
                        if (accRes.success) {
                          setAccounts(accRes.accounts);
                          if (accRes.accounts.length && !ids.act) {
                            setIds((p) => ({ ...p, act: accRes.accounts[0]!.id }));
                          }
                        }
                        if (pageRes.success) {
                          setPages(pageRes.pages);
                          if (pageRes.pages.length && !ids.page_id) {
                            setIds((p) => ({ ...p, page_id: pageRes.pages[0]!.id }));
                          }
                        }
                        setNotice({
                          kind: accRes.success && pageRes.success ? "ok" : "warn",
                          text: `تم التحديث — ${accRes.success ? accRes.accounts.length + " حساب" : accRes.error} — ${pageRes.success ? pageRes.pages.length + " صفحة" : pageRes.error}`,
                        });
                      }}
                    >
                      🔄 تحديث القوائم
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="الحساب الإعلاني">
                      <select
                        className="field font-mono"
                        dir="ltr"
                        value={ids.act}
                        onChange={(e) => setIds({ ...ids, act: e.target.value })}
                      >
                        <option value="">اختر حساباً</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.id}) — {a.currency}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="الصفحة">
                      <select
                        className="field font-mono"
                        dir="ltr"
                        value={ids.page_id}
                        onChange={(e) => setIds({ ...ids, page_id: e.target.value })}
                      >
                        <option value="">اختر صفحة</option>
                        {pages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.id})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Business ID (اختياري)">
                      {businesses.length ? (
                        <select
                          className="field font-mono"
                          dir="ltr"
                          value={ids.business_id}
                          onChange={(event) => setIds({ ...ids, business_id: event.target.value })}
                        >
                          <option value="">بدون Business محدد</option>
                          {businesses.map((business) => (
                            <option key={business.id} value={business.id}>
                              {business.name} ({business.id})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="field font-mono"
                          dir="ltr"
                          placeholder="123456789"
                          value={ids.business_id}
                          onChange={(event) =>
                            setIds({ ...ids, business_id: event.target.value.trim() })
                          }
                        />
                      )}
                    </Field>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    اتصال OAuth يجلب الحسابات والصفحات والأعمال من Graph API الرسمي. جلسة Playwright
                    تفتح صفحات Meta الثابتة داخل context مؤقت وتستخدم أي توكن مكتشف على الخادم فقط؛
                    لا يُرسل التوكن للواجهة.
                  </p>
                </div>
              )}

              {tab === "images" && (
                <div className="panel space-y-4 p-5">
                  <h2 className="font-display text-lg font-bold">🖼️ رفع الصور</h2>
                  {!ids.act ? (
                    <p className="text-sm text-warning">
                      ⚠️ اختر الحساب الإعلاني من تبويب البيانات أولاً.
                    </p>
                  ) : (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          const selected = Array.from(event.target.files ?? []);
                          const valid = selected.filter(
                            (file) =>
                              ["image/jpeg", "image/png"].includes(file.type) &&
                              file.size <= 12 * 1024 * 1024,
                          );
                          setFiles(valid.slice(0, 10));
                          if (valid.length !== selected.length || valid.length > 10) {
                            setNotice({
                              kind: "warn",
                              text: "تم قبول أول 10 صور PNG/JPEG فقط، بحد أقصى 12MB للصورة.",
                            });
                          }
                        }}
                      />
                      <div className="flex flex-wrap gap-3">
                        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
                          اختر صوراً
                        </button>
                        <button
                          className="btn-primary"
                          disabled={!files.length || busy || !sessionReady}
                          onClick={uploadAll}
                        >
                          {busy ? "جاري الرفع…" : `رفع ${files.length || ""} صورة`}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {previews.map((p) => (
                          <img
                            key={p.url}
                            src={p.url}
                            alt={p.name}
                            className="aspect-video w-full rounded-lg border border-border object-cover"
                          />
                        ))}
                      </div>
                      {hashes.length > 0 && (
                        <div className="space-y-1 rounded-lg border border-border bg-surface p-3">
                          <p className="text-sm font-bold text-success">
                            تم رفع {hashes.length} صورة
                          </p>
                          {hashes.map((h, i) => (
                            <p
                              key={h}
                              dir="ltr"
                              className="font-mono text-xs text-muted-foreground"
                            >
                              #{i + 1} {h}
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {tab === "ad" && (
                <div className="panel space-y-5 p-5">
                  <h2 className="font-display text-lg font-bold">🎯 إنشاء إعلان</h2>
                  {!ids.page_id && <p className="text-sm text-warning">⚠️ أدخل Page ID أولاً.</p>}
                  {!hashes.length && <p className="text-sm text-warning">⚠️ ارفع صورة أولاً.</p>}

                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-primary">الاستهداف</h3>
                      <Field label="الدولة">
                        <select
                          className="field"
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                        >
                          {Object.entries(COUNTRIES).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="الجنس">
                        <select
                          className="field"
                          value={gender}
                          onChange={(e) => setGender(e.target.value as "0" | "1" | "2")}
                        >
                          <option value="0">الكل</option>
                          <option value="1">ذكور</option>
                          <option value="2">إناث</option>
                        </select>
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="أقل عمر">
                          <input
                            type="number"
                            min={18}
                            max={65}
                            className="field"
                            value={ageMin}
                            onChange={(e) => setAgeMin(Number(e.target.value))}
                          />
                        </Field>
                        <Field label="أكبر عمر">
                          <input
                            type="number"
                            min={18}
                            max={65}
                            className="field"
                            value={ageMax}
                            onChange={(e) => setAgeMax(Number(e.target.value))}
                          />
                        </Field>
                      </div>
                      <Field label="معرف الجمهور المحفوظ (اختياري)">
                        <input
                          className="field font-mono"
                          dir="ltr"
                          value={savedAudienceId}
                          onChange={(e) => setSavedAudienceId(e.target.value.trim())}
                        />
                      </Field>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-primary">إعدادات الإعلان</h3>
                      <Field label="هدف الإعلان">
                        <select
                          className="field"
                          value={goal}
                          onChange={(e) => setGoal(e.target.value as "1" | "2" | "3" | "4")}
                        >
                          {Object.entries(GOALS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="الميزانية اليومية ($)">
                        <input
                          type="number"
                          min={1}
                          step={0.5}
                          className="field"
                          value={budget}
                          onChange={(e) => setBudget(Number(e.target.value))}
                        />
                      </Field>
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--color-primary)]"
                          checked={continuous}
                          onChange={(e) => setContinuous(e.target.checked)}
                        />
                        تشغيل مستمر
                      </label>
                      {!continuous && (
                        <Field label="عدد الأيام">
                          <input
                            type="number"
                            min={1}
                            max={365}
                            className="field"
                            value={days}
                            onChange={(e) => setDays(Number(e.target.value))}
                          />
                        </Field>
                      )}
                      <Field label="اسم المتجر (اختياري)">
                        <input
                          className="field"
                          value={storeName}
                          onChange={(e) => setStoreName(e.target.value)}
                        />
                      </Field>
                      <Field label="معرّف المنشور / الهدف (اختياري)">
                        <input
                          className="field font-mono"
                          dir="ltr"
                          inputMode="numeric"
                          placeholder="يُستخدم Page ID تلقائياً عند تركه فارغاً"
                          value={targetId}
                          onChange={(event) => setTargetId(event.target.value.replace(/\D/g, ""))}
                        />
                      </Field>
                      {goal === "4" && (
                        <Field label="رابط الموقع">
                          <input
                            className="field font-mono"
                            dir="ltr"
                            type="url"
                            placeholder="https://example.com"
                            value={destinationUrl}
                            onChange={(event) => setDestinationUrl(event.target.value.trim())}
                          />
                        </Field>
                      )}
                    </div>
                  </div>

                  <Field label="نص الإعلان">
                    <textarea
                      className="field h-28 resize-none"
                      placeholder="اكتب نص الإعلان هنا…"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </Field>

                  <button
                    className="btn-primary w-full"
                    disabled={
                      busy ||
                      !ids.act ||
                      !ids.page_id ||
                      !sessionReady ||
                      !hashes.length ||
                      ageMin > ageMax ||
                      (goal === "4" && !destinationUrl)
                    }
                    onClick={submitAd}
                  >
                    {busy ? "جاري الإنشاء…" : "🚀 إنشاء الإعلان"}
                  </button>
                  {adId && (
                    <p dir="ltr" className="text-center font-mono text-sm text-success">
                      Ad ID: {adId}
                    </p>
                  )}
                </div>
              )}

              {tab === "stats" && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "حالة الاتصال", value: creds ? "متصل ✅" : "غير متصل ❌" },
                    { label: "الحسابات الإعلانية", value: String(accounts.length) },
                    { label: "الصور المرفوعة", value: String(hashes.length) },
                    { label: "الإعلانات المنشأة", value: adId ? "1" : "0" },
                  ].map((m) => (
                    <div key={m.label} className="panel p-5">
                      <p className="text-xs text-muted-foreground">{m.label}</p>
                      <p className="mt-2 font-display text-2xl font-black text-primary">
                        {m.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="border-t border-border/70 py-6 text-center text-xs text-muted-foreground">
        JAMAIKA Meta Ads Pro — استخدم هذه الأداة بمسؤولية
      </footer>
    </div>
  );
}
