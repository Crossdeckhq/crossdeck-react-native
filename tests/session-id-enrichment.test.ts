// Phase 3.4 contract tests — RN track() events carry sessionId
// when the host has set one via setSessionId().
//
// Pre-v1.4.0 the RN enrichment layer merged device + super-
// properties + groups + caller but never attached a sessionId,
// so cross-platform funnel queries on the web's session anchor
// returned zero RN rows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrossdeckClient } from "../src/crossdeck";

describe("RN setSessionId() enrichment (Phase 3.4)", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function jsonResponse(body: unknown, status = 202): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function captureEvents(): { events: Array<Record<string, unknown>> } {
    const events: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (url.includes("/events")) {
        const body = init.body ? JSON.parse(init.body as string) : {};
        for (const e of body.events ?? []) events.push(e);
      }
      return Promise.resolve(jsonResponse({ object: "list", received: 1, env: "sandbox" }));
    }) as unknown as typeof fetch;
    return { events };
  }

  it("track() events carry sessionId after setSessionId() is called", async () => {
    const { events } = captureEvents();

    const c = new CrossdeckClient();
    c.init({
      appId: "app_rn_session",
      publicKey: "cd_pub_test_session",
      environment: "sandbox",
      autoHeartbeat: false,
    });

    c.setSessionId("sess_abc_123");
    c.track("page.viewed", { route: "/home" });
    await c.flush();

    const pageEvent = events.find((e) => e.name === "page.viewed");
    expect(pageEvent).toBeDefined();
    const props = pageEvent?.properties as Record<string, unknown>;
    expect(props.sessionId).toBe("sess_abc_123");
  });

  it("track() events do NOT carry sessionId before setSessionId() is called", async () => {
    const { events } = captureEvents();

    const c = new CrossdeckClient();
    c.init({
      appId: "app_rn_no_session",
      publicKey: "cd_pub_test_nosession",
      environment: "sandbox",
      autoHeartbeat: false,
    });

    // No setSessionId() call.
    c.track("page.viewed", { route: "/home" });
    await c.flush();

    const pageEvent = events.find((e) => e.name === "page.viewed");
    expect(pageEvent).toBeDefined();
    const props = pageEvent?.properties as Record<string, unknown>;
    expect(props.sessionId).toBeUndefined();
  });

  it("setSessionId(null) clears the active session", async () => {
    const { events } = captureEvents();

    const c = new CrossdeckClient();
    c.init({
      appId: "app_rn_clear_session",
      publicKey: "cd_pub_test_clearsession",
      environment: "sandbox",
      autoHeartbeat: false,
    });

    c.setSessionId("sess_first");
    c.track("event.with_session");

    c.setSessionId(null);
    c.track("event.without_session");

    await c.flush();

    const withSession = events.find((e) => e.name === "event.with_session");
    const withoutSession = events.find((e) => e.name === "event.without_session");
    expect((withSession?.properties as Record<string, unknown>)?.sessionId).toBe("sess_first");
    expect((withoutSession?.properties as Record<string, unknown>)?.sessionId).toBeUndefined();
  });

  it("caller-supplied sessionId property overrides setSessionId() value (Phase 3.2 precedence)", async () => {
    // Same merge precedence as web: caller > super > sessionId > device.
    // A caller passing sessionId explicitly in properties wins.
    const { events } = captureEvents();

    const c = new CrossdeckClient();
    c.init({
      appId: "app_rn_caller_override",
      publicKey: "cd_pub_test_override",
      environment: "sandbox",
      autoHeartbeat: false,
    });

    c.setSessionId("sess_set_via_api");
    c.track("event.x", { sessionId: "sess_caller_explicit" });
    await c.flush();

    const event = events.find((e) => e.name === "event.x");
    const props = event?.properties as Record<string, unknown>;
    expect(props.sessionId).toBe("sess_caller_explicit");
  });
});
