# @cross-deck/react-native

[![npm](https://img.shields.io/npm/v/@cross-deck/react-native.svg)](https://www.npmjs.com/package/@cross-deck/react-native)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Crossdeck's React Native SDK — **verified subscriptions, entitlements,
error capture, and product telemetry across iOS + Android JS apps in
one package**. Same SDK surface as [`@cross-deck/web`](https://github.com/Crossdeckhq/crossdeck-web)
+ [`@cross-deck/node`](https://github.com/Crossdeckhq/crossdeck-node)
— cross-platform teams write identical call-sites.

```ts
import { Crossdeck } from "@cross-deck/react-native";

Crossdeck.init({
  appId: "app_rn_xxx",
  publicKey: "cd_pub_live_…",
  environment: "production",
});

await Crossdeck.identify("user_847");
const ents = await Crossdeck.getEntitlements();
if (Crossdeck.isEntitled("pro")) showPro();
Crossdeck.track("paywall_shown", { variant: "v3" });
```

## Install

```sh
npm install @cross-deck/react-native @react-native-async-storage/async-storage
```

```sh
# Expo
npx expo install @cross-deck/react-native @react-native-async-storage/async-storage
```

`@react-native-async-storage/async-storage` is an **optional** peer
dependency. Without it the SDK falls back to in-memory storage
(identity + queue don't survive app restarts; events queued offline
are lost on cold launch). Install it for production.

## Three pillars in one SDK

| Pillar | Surface |
|---|---|
| Subscriptions & entitlements | `getEntitlements()`, `isEntitled(key)`, `listEntitlements()`, `onEntitlementsChange(listener)`, `syncPurchases({rail, signedTransactionInfo, purchaseToken})` |
| Behavioural analytics | `track(name, properties)`, `identify(userId, options)`, `register(props)`, `group(type, id, traits)`, `consent({...})` |
| Error capture | Auto: `ErrorUtils.setGlobalHandler` + `globalThis.fetch` wrap. Manual: `captureError(err)`, `captureMessage(msg)`, `setTag`, `setContext`, `addBreadcrumb`, `setErrorBeforeSend` |

## Bank-grade defaults

Every Crossdeck SDK ships these patterns by default:

- **Durable last-known-good entitlement cache.** A returning Pro
  customer reads as Pro on the FIRST `isEntitled()` after `init()`,
  even on a cold launch with no network. A Crossdeck outage can
  never fail a paying customer down to free.
- **Per-user cache isolation (v1.4.0).** Every `identify(userId)`
  switches the entitlement cache to a per-user AsyncStorage slot
  (`crossdeck:entitlements:<sha256(userId)>`) and unconditionally
  wipes the in-memory snapshot. A user-switch on a shared device
  CANNOT cross-read a prior user's cache, even if the in-memory
  clear is somehow skipped — the storage keys are physically
  separate. `reset()` then wipes every per-user slot on the device
  (logout-grade).
- **Queue durability + Stripe-style Idempotency-Key reuse.** Events
  spliced for a flush persist to AsyncStorage with the in-flight
  batch attached, so an app crash mid-flight replays the batch on
  the next launch. Backend dedupes on `(projectId, eventId)`.
- **Deterministic Idempotency-Key on `syncPurchases` (v1.4.0).**
  Same signed transaction → same key → backend short-circuits
  with `idempotent_replay: true` on retry. A network blip or app
  crash mid-flight that re-fires the same purchase never
  double-processes.
- **4xx hard-stop.** Permanent failures (401 key revoked, 400/422
  schema, 403 permission, 404 endpoint) drop the batch + fire
  `onPermanentFailure` + `console.error` regardless of debug mode.
  No silent infinite-retry-with-growing-backlog. One deliberate
  exception: HTTP `426` is NOT a drop — it parks (next bullet).
- **Outdated-version PARK (v1.7.0).** If the server ever stops
  accepting this SDK version's event format (HTTP `426` /
  `sdk_version_unsupported`), events are **parked, not lost**: held
  at the front of the durable AsyncStorage queue (FIFO-capped at
  1,000, surviving app restarts), flushing hushes (no wasted device
  battery/bandwidth), one `console.warn` names the exact version to
  update to (+ `onParked` callback and a typed `sdk.parked` debug
  event), and everything backfills on the next launch after you ship
  an upgraded build. See [the durability contract](https://cross-deck.com/docs/sdk-event-durability/).
- **PII scrub default-on.** Email-shaped and card-number-shaped
  substrings rewritten to `<email>` / `<card>` (sentinel tokens
  match the backend's defence-in-depth scrubber). Recursive — nested
  `{user:{email:...}}` payloads ship scrubbed.
- **Error self-skip from baseUrl.** Requests to the SDK's own
  Crossdeck endpoint never trigger captureHttp — otherwise a
  Crossdeck outage would recurse forever.
- **Boot heartbeat.** Verifies the publishable key against the
  Crossdeck API the moment the SDK is constructed. The dashboard's
  "Verify install" check turns green within ~200ms.

## Init options

| Option | Default | Notes |
|---|---|---|
| `appId` | — | **Required.** From the Crossdeck dashboard. |
| `publicKey` | — | **Required.** `cd_pub_live_…` or `cd_pub_test_…`. |
| `environment` | — | **Required.** `"production"` or `"sandbox"`. Must match key prefix. |
| `baseUrl` | `https://api.cross-deck.com/v1` | Override for self-hosted setups. |
| `persistIdentity` | `true` | Set false to defer AsyncStorage writes until after a consent gate. |
| `storage` | AsyncStorage (auto-detected) | Pass a SecureStore / MMKV adapter for higher-security app shells. |
| `storagePrefix` | `"crossdeck:"` | Key namespace inside the storage adapter. |
| `autoHeartbeat` | `true` | Disable for CI / tests. |
| `eventFlushBatchSize` | `20` | Flush when buffer reaches this size. |
| `eventFlushIntervalMs` | `5000` | Idle interval before flushing a partial batch. |
| `appVersion` | — | Your app's version (e.g. `"1.2.3"`). Auto-attached to every event as `properties.appVersion`. |
| `platform` | auto-detected | Override the `Platform.OS` detection. |
| `timeoutMs` | `15000` | Per-request HTTP timeout. |
| `debug` | `false` | Verbose diagnostic logging via the §16 debug-signal vocabulary. |
| `scrubPii` | `true` | Disable only if your pipeline does its own PII redaction downstream. |
| `errorCapture` | `true` | Disable if you have a separate error tracker (Sentry, Bugsnag) and don't want duplicates. |

## Lifecycle

`init()` returns void but kicks off async hydration (identity, super-
props, entitlement cache, persisted event queue). Every async method
(`identify`, `track`, `flush`, `getEntitlements`, etc.) awaits the
internal `ready` promise — callers can fire methods immediately after
`init()` without manual sequencing.

Sync methods (`isEntitled`, `getSuperProperties`, `diagnostics`)
read in-memory state. Until `init()` has fired they return sensible
empties.

## Foreground/background lifecycle (v1.0)

v1.0 ships WITHOUT auto-session tracking. Wire your nav library's
listener into:

```ts
import { AppState } from "react-native";

AppState.addEventListener("change", (state) => {
  if (state === "background") {
    void Crossdeck.flush();
  }
});
```

Auto sessions + deep-link tracking land in v1.1 as opt-in
`autoTrack: { sessions, deepLinks }`.

## Diagnostics

```ts
Crossdeck.diagnostics();
// {
//   started: true,
//   anonymousId: "anon_1mqz3…",
//   crossdeckCustomerId: "cdcust_abc",
//   developerUserId: "user_847",
//   sdkVersion: "1.7.1",
//   baseUrl: "https://api.cross-deck.com/v1",
//   platform: "ios",
//   clock: { lastServerTime: 1779…, lastClientTime: 1779…, skewMs: 12 },
//   entitlements: { count: 2, lastUpdated: 1779…, stale: false, listenerErrors: 0 },
//   events: { buffered: 0, dropped: 0, inFlight: 0, lastFlushAt: 1779…, lastError: null, consecutiveFailures: 0, nextRetryAt: null }
// }
```

## Bank-grade contracts

The SDK ships its own contracts registry — every behavioural guarantee the SDK makes (per-user cache isolation, deterministic Idempotency-Key, queue durability, etc.) lives in `contracts/**/*.json` at the monorepo root and is **bundled into every release**. The customer's lockfile pins SDK code + contracts atomically — drift between what the SDK does and what it claims is structurally impossible. See [`contracts/README.md`](https://github.com/VistaApps-za/crossdeck/blob/main/contracts/README.md) for the full architecture.

### `CrossdeckContracts` — typed access to the bundled registry

```ts
import { CrossdeckContracts } from "@cross-deck/react-native";

CrossdeckContracts.all();                              // enforced contracts only
CrossdeckContracts.allIncludingHistorical();           // + proposed + retired
CrossdeckContracts.byId("per-user-cache-isolation");
CrossdeckContracts.byPillar("entitlements");
CrossdeckContracts.withStatus("proposed");
CrossdeckContracts.findByTestName("identify(B) makes A's entitlements unreachable from in-memory");
CrossdeckContracts.sdkVersion;        // "1.7.1"
CrossdeckContracts.bundledIn;         // "@cross-deck/react-native@1.7.1"
```

The `Contract` type is exported alongside; the binary-stability promise is documented in [`contracts/README.md`](https://github.com/VistaApps-za/crossdeck/blob/main/contracts/README.md).

### `Crossdeck.reportContractFailure(input)` — surface contract test failures

When a contract test asserts and fails — in your CI, a dogfood run, or a customer integration test — fire a typed `crossdeck.contract_failed` event over the **Crossdeck reliability channel**. This is one-way operational telemetry to the Crossdeck operations team (Privacy Policy §6, "Flow B"); it never enters your `track()` pipeline, never shows in your dashboard, never bills against your event quota. The wire shape is schema-locked at [`contracts/diagnostics/contract-failed-payload-schema-lock.json`](https://github.com/VistaApps-za/crossdeck/blob/main/contracts/diagnostics/contract-failed-payload-schema-lock.json):

```ts
Crossdeck.reportContractFailure({
  contractId: "per-user-cache-isolation",
  failureReason: "expected isolation across user switch, got cross-read",
  runContext: __DEV__ ? "dogfood" : "ci",
  runId: process.env.GITHUB_RUN_ID ?? Date.now().toString(36),
  testRef: {
    file: "tests/entitlement-cache-isolation.test.ts",
    name: "identify(B) makes A's entitlements unreachable from in-memory",
  },
});
```

No new endpoint, no special ingest path — the event lands in the same pipeline every other `track()` call does. It surfaces immediately in the dashboard's live event feed, the breakdown chart (group by `contract_id`, `sdk_platform`), and any alert rule with `event = crossdeck.contract_failed`.

Properties stamped on the wire:

| Property | Source |
|----------|--------|
| `contract_id` | caller |
| `sdk_version`, `sdk_platform` | auto-stamped (`@cross-deck/react-native` ships `sdk_platform: "react-native"`) |
| `failure_reason`, `run_context`, `run_id` | caller |
| `test_file`, `test_name` | set when `testRef` is provided |
| `device_class` | optional, set by caller (categorical bucket — e.g. `"ios-phone"`, `"android-tablet"`) |

The wire shape is schema-locked at [`contracts/diagnostics/contract-failed-payload-schema-lock.json`](https://github.com/VistaApps-za/crossdeck/blob/main/contracts/diagnostics/contract-failed-payload-schema-lock.json); per-SDK assertion tests gate it on every release. Free-form `extra` keys are not accepted — adding a field requires an amendment to the schema-lock contract first.

For per-test-framework hooks see [`contracts/README.md` § Reporting contract failures](https://github.com/VistaApps-za/crossdeck/blob/main/contracts/README.md#reporting-contract-failures-back-to-crossdeck).

## Documentation

- [Full SDK reference](https://cross-deck.com/docs/react-native-sdk)
- [Identify users](https://cross-deck.com/docs/identify-users)
- [Track events](https://cross-deck.com/docs/track-events)
- [Entitlements gating](https://cross-deck.com/docs/entitlements)
- [Error capture](https://cross-deck.com/docs/errors)

## License

MIT © Crossdeck
