import assert from "node:assert/strict";
import test from "node:test";

import { createOAuthState, getMetaConfig } from "../src/lib/meta-session.server.ts";

const META_KEYS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_REDIRECT_URI",
  "META_SESSION_SECRET",
  "META_GRAPH_API_VERSION",
  "META_OAUTH_SCOPES",
] as const;

function withMetaEnvironment(values: Partial<Record<(typeof META_KEYS)[number], string>>) {
  const previous = Object.fromEntries(META_KEYS.map((key) => [key, process.env[key]]));
  for (const key of META_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  return () => {
    for (const key of META_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("rejects incomplete or weak Meta OAuth configuration", () => {
  const restore = withMetaEnvironment({
    META_APP_ID: "123",
    META_APP_SECRET: "secret",
    META_REDIRECT_URI: "https://example.com/auth/meta/callback",
    META_SESSION_SECRET: "too-short",
  });
  try {
    assert.equal(getMetaConfig(), null);
  } finally {
    restore();
  }
});

test("normalizes a complete Meta OAuth configuration", () => {
  const restore = withMetaEnvironment({
    META_APP_ID: "123",
    META_APP_SECRET: "secret",
    META_REDIRECT_URI: "https://example.com/auth/meta/callback",
    META_SESSION_SECRET: "a".repeat(32),
    META_GRAPH_API_VERSION: "invalid",
    META_OAUTH_SCOPES: "ads_read, business_management,ads_read",
  });
  try {
    const config = getMetaConfig();
    assert.ok(config);
    assert.equal(config.graphVersion, "v25.0");
    assert.deepEqual(config.scopes, ["ads_read", "business_management"]);
    assert.equal(config.redirectUri, "https://example.com/auth/meta/callback");
  } finally {
    restore();
  }
});

test("creates unique URL-safe OAuth state values", () => {
  const first = createOAuthState();
  const second = createOAuthState();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});
