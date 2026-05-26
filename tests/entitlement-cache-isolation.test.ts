// Phase 1.3 contract tests — cross-tenant entitlement cache scoping.
//
// Three-layer bank-grade isolation that MUST survive any code drift:
//   (a) Per-user storage key — `crossdeck:entitlements:<sha256(userId)>`.
//   (b) identify() unconditionally wipes in-memory cache + switches slot.
//   (c) reset() wipes EVERY per-user slot via the persisted index.
//
// RN-side asyncStorage variant — mirrors sdks/web/tests/entitlement-
// cache-isolation.test.ts with await/Promise around every storage call.

import { describe, it, expect, beforeEach } from "vitest";
import { EntitlementCache } from "../src/entitlement-cache";
import { sha256Hex } from "../src/hash";
import type { KeyValueStorage, PublicEntitlement } from "../src/types";

class AsyncMapStorage implements KeyValueStorage {
  public data = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }
}

function ent(key: string, productId = "monthly_pro"): PublicEntitlement {
  return {
    object: "entitlement",
    key,
    isActive: true,
    validUntil: null,
    source: { rail: "stripe", productId, subscriptionId: "sub_x" },
    updatedAt: 1_700_000_000,
  };
}

async function settle(): Promise<void> {
  // Allow fire-and-forget setItem writes (the cache's persist() path)
  // to land before the next assertion.
  await new Promise((r) => setTimeout(r, 5));
}

describe("EntitlementCache isolation (Phase 1.3 — RN)", () => {
  describe("SHA-256 vectors", () => {
    it("matches FIPS 180-4 reference vector for the empty string", () => {
      expect(sha256Hex("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });

    it("matches FIPS 180-4 reference vector for 'abc'", () => {
      expect(sha256Hex("abc")).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    });

    it("UTF-8 encodes multi-byte characters distinctly from ASCII", () => {
      const ascii = sha256Hex("cafe");
      const utf8 = sha256Hex("café");
      expect(ascii).not.toBe(utf8);
      expect(utf8).toMatch(/^[0-9a-f]{64}$/);
    });

    it("differs across user ids", () => {
      expect(sha256Hex("alice")).not.toBe(sha256Hex("bob"));
    });
  });

  describe("layer (a) — physical key separation per user", () => {
    let storage: AsyncMapStorage;
    let cache: EntitlementCache;

    beforeEach(() => {
      storage = new AsyncMapStorage();
      cache = new EntitlementCache(storage);
    });

    it("identified writes land under :<sha256(userId)>", async () => {
      await cache.setUserKey("alice");
      cache.setFromList([ent("pro")]);
      await settle();
      const expectedKey = `crossdeck:entitlements:${sha256Hex("alice")}`;
      expect(storage.data.has(expectedKey)).toBe(true);
    });

    it("two different users use two different storage keys", async () => {
      await cache.setUserKey("alice");
      cache.setFromList([ent("pro")]);
      await settle();
      await cache.setUserKey("bob");
      cache.setFromList([ent("trial")]);
      await settle();

      const aliceKey = `crossdeck:entitlements:${sha256Hex("alice")}`;
      const bobKey = `crossdeck:entitlements:${sha256Hex("bob")}`;
      expect(storage.data.has(aliceKey)).toBe(true);
      expect(storage.data.has(bobKey)).toBe(true);
      expect(aliceKey).not.toBe(bobKey);
    });
  });

  describe("layer (b) — identify() unconditional in-memory clear", () => {
    let storage: AsyncMapStorage;
    let cache: EntitlementCache;

    beforeEach(() => {
      storage = new AsyncMapStorage();
      cache = new EntitlementCache(storage);
    });

    it("identify(B) makes A's entitlements unreachable from in-memory", async () => {
      await cache.setUserKey("alice");
      cache.setFromList([ent("pro")]);
      await settle();
      expect(cache.isEntitled("pro")).toBe(true);

      await cache.setUserKey("bob");

      expect(cache.isEntitled("pro")).toBe(false);
      expect(cache.list()).toEqual([]);
    });

    it("identify(B) then identify(A) restores A's slot from storage", async () => {
      await cache.setUserKey("alice");
      cache.setFromList([ent("pro")]);
      await settle();
      await cache.setUserKey("bob");
      cache.setFromList([ent("trial")]);
      await settle();

      await cache.setUserKey("alice");
      expect(cache.isEntitled("pro")).toBe(true);
      expect(cache.isEntitled("trial")).toBe(false);
    });
  });

  describe("layer (c) — clearAll() wipes EVERY per-user slot", () => {
    it("removes every per-user storage key plus the index", async () => {
      const storage = new AsyncMapStorage();
      const cache = new EntitlementCache(storage);

      await cache.setUserKey("alice");
      cache.setFromList([ent("pro")]);
      await settle();
      await cache.setUserKey("bob");
      cache.setFromList([ent("trial")]);
      await settle();
      await cache.setUserKey("charlie");
      cache.setFromList([ent("enterprise")]);
      await settle();

      await cache.clearAll();

      const remaining = [...storage.data.keys()].filter((k) =>
        k.startsWith("crossdeck:entitlements"),
      );
      expect(remaining).toEqual([]);
    });

    it("does NOT touch unrelated host-app storage keys", async () => {
      const storage = new AsyncMapStorage();
      await storage.setItem("app:user_preferences", '{"theme":"dark"}');
      const cache = new EntitlementCache(storage);
      await cache.setUserKey("alice");
      cache.setFromList([ent("pro")]);
      await settle();

      await cache.clearAll();

      expect(await storage.getItem("app:user_preferences")).toBe(
        '{"theme":"dark"}',
      );
    });
  });

  describe("defence-in-depth — physical isolation across cache instances", () => {
    it("a fresh cache bound to A's key CANNOT read B's blob", async () => {
      const storage = new AsyncMapStorage();

      const aCache = new EntitlementCache(storage);
      await aCache.setUserKey("alice");
      aCache.setFromList([ent("pro_a")]);
      await settle();

      const bCache = new EntitlementCache(storage);
      await bCache.setUserKey("bob");
      bCache.setFromList([ent("pro_b")]);
      await settle();

      const rogueAlice = new EntitlementCache(storage);
      await rogueAlice.setUserKey("alice");
      expect(rogueAlice.isEntitled("pro_a")).toBe(true);
      expect(rogueAlice.isEntitled("pro_b")).toBe(false);

      const rogueBob = new EntitlementCache(storage);
      await rogueBob.setUserKey("bob");
      expect(rogueBob.isEntitled("pro_b")).toBe(true);
      expect(rogueBob.isEntitled("pro_a")).toBe(false);
    });
  });
});
