import { createServerFn } from "@tanstack/react-start";

import { getMetaConfig, getMetaSession } from "./meta-session.server";

const META_TIMEOUT_MS = 20_000;

type GraphCollection<T> = {
  data?: T[];
  error?: { code?: number; message?: string; type?: string };
};

async function graphCollection<T>(
  version: string,
  path: string,
  token: string,
  fields: string,
  limit: number,
) {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(META_TIMEOUT_MS),
  });
  const body = (await response.json()) as GraphCollection<T>;
  if (!response.ok || body.error) {
    const code = body.error?.code ?? response.status;
    throw new Error(`Meta Graph API error ${code}`);
  }
  return Array.isArray(body.data) ? body.data : [];
}

export const getMetaConnection = createServerFn({ method: "GET" }).handler(async () => {
  const config = getMetaConfig();
  if (!config) {
    return {
      configured: false,
      connected: false,
      userId: null,
      userName: null,
      expiresAt: null,
    };
  }
  const session = await getMetaSession(config);
  const expired = Boolean(session.data.expiresAt && session.data.expiresAt <= Date.now());
  if (expired) await session.clear();
  return {
    configured: true,
    connected: Boolean(session.data.accessToken && !expired),
    userId: expired ? null : (session.data.userId ?? null),
    userName: expired ? null : (session.data.userName ?? null),
    expiresAt: expired ? null : (session.data.expiresAt ?? null),
  };
});

export const fetchMetaAssets = createServerFn({ method: "GET" }).handler(async () => {
  const config = getMetaConfig();
  if (!config) {
    return {
      success: false as const,
      accounts: [],
      pages: [],
      businesses: [],
      error: "إعدادات Meta OAuth غير مكتملة على الخادم.",
    };
  }
  const session = await getMetaSession(config);
  const token = session.data.accessToken;
  if (!token || (session.data.expiresAt && session.data.expiresAt <= Date.now())) {
    if (token) await session.clear();
    return {
      success: false as const,
      accounts: [],
      pages: [],
      businesses: [],
      error: "جلسة Meta غير متصلة أو انتهت صلاحيتها.",
    };
  }

  try {
    const [rawAccounts, rawPages, rawBusinesses] = await Promise.all([
      graphCollection<{
        id?: string;
        account_id?: string;
        name?: string;
        currency?: string;
        account_status?: number;
      }>(
        config.graphVersion,
        "me/adaccounts",
        token,
        "id,account_id,name,currency,account_status",
        500,
      ),
      graphCollection<{ id?: string; name?: string }>(
        config.graphVersion,
        "me/accounts",
        token,
        "id,name",
        200,
      ),
      graphCollection<{ id?: string; name?: string }>(
        config.graphVersion,
        "me/businesses",
        token,
        "id,name",
        100,
      ),
    ]);

    const accounts = rawAccounts
      .filter((account) => /^\d+$/.test(account.account_id ?? ""))
      .map((account) => ({
        id: account.account_id!,
        name: account.name?.trim() || `Ad Account ${account.account_id}`,
        currency: account.currency?.toUpperCase() || "USD",
        status: account.account_status ?? 0,
      }));
    const pages = rawPages
      .filter((page) => /^\d+$/.test(page.id ?? ""))
      .map((page) => ({ id: page.id!, name: page.name?.trim() || `Page ${page.id}` }));
    const businesses = rawBusinesses
      .filter((business) => /^\d+$/.test(business.id ?? ""))
      .map((business) => ({
        id: business.id!,
        name: business.name?.trim() || `Business ${business.id}`,
      }));

    return { success: true as const, accounts, pages, businesses, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta Graph API error";
    if (/error (?:190|401)\b/.test(message)) await session.clear();
    return {
      success: false as const,
      accounts: [],
      pages: [],
      businesses: [],
      error: `تعذّر جلب الأصول (${message}). راجع صلاحيات التطبيق أو أعد الاتصال.`,
    };
  }
});

export const disconnectMeta = createServerFn({ method: "POST" }).handler(async () => {
  const config = getMetaConfig();
  if (config) {
    const session = await getMetaSession(config);
    await session.clear();
  }
  return { success: true };
});
