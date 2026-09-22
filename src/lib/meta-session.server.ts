import { useSession as openServerSession } from "@tanstack/react-start/server";

const DEFAULT_GRAPH_VERSION = "v25.0";
const DEFAULT_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
];

export type MetaSessionData = {
  oauthState?: string | null;
  oauthStartedAt?: number | null;
  accessToken?: string | null;
  userId?: string | null;
  userName?: string | null;
  expiresAt?: number | null;
};

export type MetaConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  sessionSecret: string;
  graphVersion: string;
  scopes: string[];
};

export function getMetaConfig(): MetaConfig | null {
  const appId = process.env["META_APP_ID"]?.trim();
  const appSecret = process.env["META_APP_SECRET"]?.trim();
  const redirectUri = process.env["META_REDIRECT_URI"]?.trim();
  const sessionSecret = process.env["META_SESSION_SECRET"]?.trim();

  if (!appId || !appSecret || !redirectUri || !sessionSecret || sessionSecret.length < 32) {
    return null;
  }

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(redirectUrl.protocol)) return null;

  const requestedVersion = process.env["META_GRAPH_API_VERSION"]?.trim();
  const graphVersion =
    requestedVersion && /^v\d+\.\d+$/.test(requestedVersion)
      ? requestedVersion
      : DEFAULT_GRAPH_VERSION;
  const requestedScopes = process.env["META_OAUTH_SCOPES"]
    ?.split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return {
    appId,
    appSecret,
    redirectUri: redirectUrl.toString(),
    sessionSecret,
    graphVersion,
    scopes: requestedScopes?.length ? [...new Set(requestedScopes)] : DEFAULT_SCOPES,
  };
}

export function getMetaSession(config: MetaConfig) {
  const secure = new URL(config.redirectUri).protocol === "https:";
  return openServerSession<MetaSessionData>({
    password: config.sessionSecret,
    name: secure ? "__Host-jamaika-meta" : "jamaika-meta",
    maxAge: 60 * 60 * 24 * 60,
    cookie: {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
    },
  });
}

export function createOAuthState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
