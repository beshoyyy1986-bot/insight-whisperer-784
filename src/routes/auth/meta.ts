import { createFileRoute } from "@tanstack/react-router";

import { createOAuthState, getMetaConfig, getMetaSession } from "@/lib/meta-session.server";

function homeRedirect(request: Request, error: string) {
  const target = new URL("/", request.url);
  target.searchParams.set("meta_error", error);
  return new Response(null, { status: 302, headers: { location: target.toString() } });
}

export const Route = createFileRoute("/auth/meta")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getMetaConfig();
        if (!config) return homeRedirect(request, "not_configured");

        const state = createOAuthState();
        const session = await getMetaSession(config);
        await session.update({ oauthState: state, oauthStartedAt: Date.now() });

        const authorize = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
        authorize.searchParams.set("client_id", config.appId);
        authorize.searchParams.set("redirect_uri", config.redirectUri);
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("state", state);
        authorize.searchParams.set("scope", config.scopes.join(","));
        return new Response(null, { status: 302, headers: { location: authorize.toString() } });
      },
    },
  },
});
