import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAnyInput } from "../src/lib/fb.functions.ts";

test("parses a cookie header and ads-manager identifiers", () => {
  const parsed = parseAnyInput(
    "curl 'https://www.facebook.com/adsmanager/manage/campaigns?act=123456789&business_id=987654321' " +
      "-H 'cookie: c_user=123456789; xs=session-value; fr=browser-value'",
  );

  assert.equal(parsed.uid, "123456789");
  assert.equal(parsed.act, "123456789");
  assert.equal(parsed.businessId, "987654321");
  assert.match(parsed.cookieString ?? "", /^c_user=123456789; xs=session-value; fr=browser-value$/);
});

test("parses tab-separated DevTools request dumps and persisted GraphQL documents", () => {
  const parsed = parseAnyInput(`
av\t"223456789"
__user\t"123456789"
__bid\t"678901234"
__dyn\t"dynamic-session-value"
__rev\t"1047882213"
fb_dtsg\t"NA-test-session-token-value"
jazoest\t"212345"
fb_api_req_friendly_name\t"LWICometCreateBoostedComponentMutation"
variables\t'{"input":{"page_id":"345678901","target_id":"456789012"}}'
doc_id\t"9955578997835249"
ad_account\t{ currency: "USD", id: "567890123" }
`);

  assert.equal(parsed.uid, "123456789");
  assert.equal(parsed.av, "223456789");
  assert.equal(parsed.dtsg, "NA-test-session-token-value");
  assert.equal(parsed.jazoest, "212345");
  assert.equal(parsed.pageId, "345678901");
  assert.equal(parsed.act, "567890123");
  assert.equal(parsed.businessId, "678901234");
  assert.deepEqual(parsed.dynParams, {
    __dyn: "dynamic-session-value",
    __rev: "1047882213",
  });
  assert.deepEqual(parsed.graphqlDocuments, {
    LWICometCreateBoostedComponentMutation: "9955578997835249",
  });
});

test("does not mistake unrelated text for credentials", () => {
  const parsed = parseAnyInput("ordinary text with no session material");

  assert.equal(parsed.cookieString, null);
  assert.equal(parsed.uid, null);
  assert.equal(parsed.dtsg, null);
  assert.equal(parsed.graphqlDocuments, null);
});
