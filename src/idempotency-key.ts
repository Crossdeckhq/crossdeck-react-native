/**
 * Deterministic Idempotency-Key derivation for /purchases/sync.
 *
 * Phase 2.2 of bank-grade reconciliation v1.4.0. Mirrors
 * `sdks/web/src/idempotency-key.ts` byte-for-byte except for the
 * import line — the publish-sdk-to-public-repo contract copies
 * each per-SDK source tree verbatim, so duplication keeps each
 * package self-contained.
 */

import { sha256Hex } from "./hash";

export interface PurchaseSyncIdentity {
  rail: "apple" | "google" | "stripe" | string;
  signedTransactionInfo?: string;
  purchaseToken?: string;
}

export function formatAsUuid(hex: string): string {
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function deriveIdempotencyKeyForPurchase(body: PurchaseSyncIdentity): string {
  let identifier: string;
  if (body.rail === "apple") {
    identifier = body.signedTransactionInfo ?? "";
  } else if (body.rail === "google") {
    identifier = body.purchaseToken ?? "";
  } else {
    identifier = "";
  }
  if (!identifier) {
    throw new Error(
      `deriveIdempotencyKeyForPurchase: no stable identifier in body ` +
        `(rail=${body.rail}). Apple needs signedTransactionInfo; ` +
        `Google needs purchaseToken.`,
    );
  }
  const namespaced = `crossdeck:purchases/sync:${body.rail}:${identifier}`;
  return formatAsUuid(sha256Hex(namespaced));
}
