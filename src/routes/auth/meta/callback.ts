import { createFileRoute } from "@tanstack/react-router";

import { getMetaConfig, getMetaSession } from "@/lib/meta-session.server";

const OAUTH_TIMEOUT_MS = 20_000;
const STATE_MAX_AGE_MS = 10 * 60 * 1_000;

function homeRedirect(request: Request, key: "meta" | "meta_error", value: string) {
  const target = new URL("/", request.url);
  target.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { location: target.toString() } });
}

async function tokenRequest(url: string, body: URLSearchParams) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { code?: number; message?: string };
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(`token_exchange_${payload.error?.code ?? response.status}`);
  }
  return payload;
}

export const Route = createFileRoute("/auth/meta/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getMetaConfig();
        if (!config) return homeRedirect(request, "meta_error", "not_configured");

        const callback = new URL(request.url);
        const code = callback.searchParams.get("code");
        const state = callback.searchParams.get("state");
        const providerError = callback.searchParams.get("error");
        const session = await getMetaSession(config);
        const stateExpired =
          !session.data.oauthStartedAt ||
          Date.now() - session.data.oauthStartedAt > STATE_MAX_AGE_MS;

        if (
          providerError ||
          !code ||
          !state ||
          !session.data.oauthState ||
          state !== session.data.oauthState ||
          stateExpired
        ) {
          await session.update({ oauthState: null, oauthStartedAt: null });
          return homeRedirect(request, "meta_error", providerError ? "denied" : "invalid_state");
        }

        try {
          const shortLived = await tokenRequest(
            `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`,
            new URLSearchParams({
              client_id: config.appId,
              client_secret: config.appSecret,
              redirect_uri: config.redirectUri,
              code,
            }),
          );

          let accessToken = shortLived.access_token!;
          let expiresIn = shortLived.expires_in;
          try {
            const longLived = await tokenRequest(
              `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`,
              new URLSearchParams({
                grant_type: "fb_exchange_token",
                client_id: config.appId,
                client_secret: config.appSecret,
                fb_exchange_token: accessToken,
              }),
            );
            accessToken = longLived.access_token!;
            expiresIn = longLived.expires_in ?? expiresIn;
          } catch {
            // A valid short-lived token is still preferable to failing the login.
          }

          const profileResponse = await fetch(
            `https://graph.facebook.com/${config.graphVersion}/me?fields=id,name`,
            {
              headers: { authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
            },
          );
          const profile = (await profileResponse.json()) as { id?: string; name?: string };
          if (!profileResponse.ok || !profile.id) throw new Error("profile_validation_failed");

          await session.update({
            oauthState: null,
            oauthStartedAt: null,
            accessToken,
            userId: profile.id,
            userName: profile.name ?? "Meta user",
            expiresAt: expiresIn ? Date.now() + expiresIn * 1_000 : null,
          });
          return homeRedirect(request, "meta", "connected");
        } catch {
          await session.update({ oauthState: null, oauthStartedAt: null });
          return homeRedirect(request, "meta_error", "exchange_failed");
        }
      },
    },
  },
});
