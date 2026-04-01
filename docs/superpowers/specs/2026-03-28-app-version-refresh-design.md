# App Version Refresh — Design Spec

## Problem

After a deploy, users may continue using a stale cached version of the app. There is no mechanism to notify them that a new version is available or to trigger a refresh.

## Solution

A lightweight version-polling system that detects new deploys and prompts the user to reload.

## Architecture

### Build Time

A Vite plugin (`versionFilePlugin`) writes `dist/version.json` during the `closeBundle` hook:

```json
{ "version": "7b8e79adfd9ba7c6" }
```

The hash is generated using the existing `randomHash` function in `vite.config.ts`, so each build produces a unique value.

### Runtime

A `useVersionCheck` hook polls `GET /version.json?t=<timestamp>` every 60 seconds.

**Flow:**

1. On mount, fetch `/version.json` and store the hash as `knownVersion`.
2. On each subsequent poll, compare the fetched version to `knownVersion`.
3. If different and the user is NOT on a suppressed view (`txStatus`), show an `info` notice via the existing `NoticeContext`.
4. If different and the user IS on a suppressed view, set a `pendingUpdate` flag and show the notice once they navigate away.
5. The notice includes a reload action that calls `window.location.reload()`.
6. After showing the notice, stop polling (no need to keep checking).

## Components

### New Files

- **`abroad-ui/src/shared/hooks/useVersionCheck.ts`** — the polling hook
  - Params: `{ pollingIntervalMs?: number, suppressWhileViews?: string[] }`
  - Defaults: 60000ms polling, suppress during `['txStatus']`
  - Uses `addNotice` from `NoticeContext`

### Modified Files

- **`abroad-ui/vite.config.ts`** — add `versionFilePlugin` to the plugins array
- **`abroad-ui/src/pages/WebSwap/WebSwap.tsx`** (or `useWebSwapController.ts`) — call `useVersionCheck` with current view and suppress config

### Unchanged

- `NoticeContext` / `NoticeCenter` — reused as-is
- `firebase.json` — default Firebase caching gives short TTL for non-hashed files
- Deploy workflow — no changes needed

## Error Handling

- **Fetch failures:** silently ignored, retry on next interval.
- **Cache busting:** `?t=<Date.now()>` appended to every fetch.
- **Multiple tabs:** each polls independently; reloading any tab picks up the new version.
- **Rapid deploys:** only one notice shown for the latest version, no stacking.
- **MiniPay webview:** standard `fetch` + `location.reload()`, no special handling.
- **First load:** sets the baseline version, never triggers a notice.

## Scope

- No service worker.
- No offline support.
- No forced/silent reload — always user-initiated via the notice.
- Payment-safe: notice is suppressed during `txStatus` view.
