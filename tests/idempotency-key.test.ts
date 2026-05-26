// Phase 2.2 contract tests — RN-side mirror of the web suite.
// Same input -> same key contract; the SDK implementations are
// byte-identical except for the imports.

import { describe, it, expect } from "vitest";
import {
  deriveIdempotencyKeyForPurchase,
  formatAsUuid,
} from "../src/idempotency-key";

describe("deriveIdempotencyKeyForPurchase (RN)", () => {
  it("is deterministic", () => {
    const body = {
      rail: "apple",
      signedTransactionInfo: "eyJ.jws.sig",
    };
    expect(deriveIdempotencyKeyForPurchase(body)).toBe(
      deriveIdempotencyKeyForPurchase(body),
    );
  });

  it("returns UUID-shaped string", () => {
    const key = deriveIdempotencyKeyForPurchase({
      rail: "apple",
      signedTransactionInfo: "eyJ.jws.sig",
    });
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("cross-SDK oracle — apple JWS pins canonical vector", () => {
    // Canonical vector — same input on Web/Node/Swift/Android MUST
    // produce this exact UUID. Pin computed via:
    //   node -e "const c=require('crypto');console.log(c.createHash('sha256').update('crossdeck:purchases/sync:apple:eyJ.jws.sig').digest('hex'))"
    // A regression here breaks the wire-protocol parity Stripe-
    // grade idempotency depends on.
    const key = deriveIdempotencyKeyForPurchase({
      rail: "apple",
      signedTransactionInfo: "eyJ.jws.sig",
    });
    expect(key).toBe("a66b1640-efaf-bb4d-1261-6650033bf111");
  });

  it("different rails -> different keys for same identifier", () => {
    const apple = deriveIdempotencyKeyForPurchase({
      rail: "apple",
      signedTransactionInfo: "shared",
    });
    const google = deriveIdempotencyKeyForPurchase({
      rail: "google",
      purchaseToken: "shared",
    });
    expect(apple).not.toBe(google);
  });

  it("throws on missing identifier", () => {
    expect(() => deriveIdempotencyKeyForPurchase({ rail: "apple" })).toThrow();
  });
});

describe("formatAsUuid (RN)", () => {
  it("formats 32 hex chars as 8-4-4-4-12", () => {
    expect(formatAsUuid("0123456789abcdef0123456789abcdef")).toBe(
      "01234567-89ab-cdef-0123-456789abcdef",
    );
  });
});
