# App Version Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect new app deployments and prompt the user to reload via a non-intrusive notice.

**Architecture:** A Vite plugin writes a `version.json` file at build time with a unique hash. A React hook polls this file every 60s and shows a reload notice via the existing `NoticeContext` when the hash changes. The notice is suppressed during the `txStatus` view to avoid interrupting payments.

**Tech Stack:** Vite plugin (build), React hook (runtime), existing NoticeContext/NoticeCenter (UI)

---

### Task 1: Vite plugin — generate version.json at build time

**Files:**
- Modify: `abroad-ui/vite.config.ts`

- [ ] **Step 1: Add the versionFilePlugin after the existing `randomHash` function**

Add this plugin definition and register it in the `plugins` array:

```typescript
// In vite.config.ts, after the readEnv function (line 31), add:

const buildVersion = randomHash('__build_version__')

function versionFilePlugin(): PluginOption {
  return {
    apply: 'build',
    closeBundle() {
      const fs = require('node:fs')
      const outPath = path.resolve(__dirname, 'dist', 'version.json')
      fs.writeFileSync(outPath, JSON.stringify({ version: buildVersion }))
    },
    name: 'version-file',
  }
}
```

Then add it to the plugins array (line 22):

```typescript
const plugins: PluginOption[] = [
  react({ include: '**/*.tsx' }),
  tailwindcss(),
  versionFilePlugin(),
]
```

Also add the `fs` import at the top alongside the existing `crypto` and `path` imports:

```typescript
import fs from 'node:fs'
```

And update `closeBundle` to use the top-level import instead of `require`:

```typescript
closeBundle() {
  const outPath = path.resolve(__dirname, 'dist', 'version.json')
  fs.writeFileSync(outPath, JSON.stringify({ version: buildVersion }))
},
```

- [ ] **Step 2: Verify the plugin works by running a build**

Run: `cd abroad-ui && npm run build`

Then check the output:

Run: `cat abroad-ui/dist/version.json`

Expected: `{"version":"<16-char-hex-string>"}`

- [ ] **Step 3: Commit**

```bash
git add abroad-ui/vite.config.ts
git commit -m "feat: add Vite plugin to generate version.json at build time"
```

---

### Task 2: useVersionCheck hook — poll and detect new versions

**Files:**
- Create: `abroad-ui/src/shared/hooks/useVersionCheck.ts`
- Modify: `abroad-ui/src/shared/hooks/index.ts`

- [ ] **Step 1: Create the hook file**

Create `abroad-ui/src/shared/hooks/useVersionCheck.ts`:

```typescript
import { useCallback, useEffect, useRef } from 'react'

import { useNotices } from '../../contexts/NoticeContext'

const DEFAULT_INTERVAL_MS = 60_000

interface UseVersionCheckOptions {
  currentView?: string
  pollingIntervalMs?: number
  suppressWhileViews?: string[]
}

async function fetchRemoteVersion(): Promise<string | null> {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`)
    if (!response.ok) return null
    const data = await response.json()
    return typeof data?.version === 'string' ? data.version : null
  }
  catch {
    return null
  }
}

export function useVersionCheck({
  currentView,
  pollingIntervalMs = DEFAULT_INTERVAL_MS,
  suppressWhileViews = [],
}: UseVersionCheckOptions = {}): void {
  const { addNotice } = useNotices()
  const knownVersionRef = useRef<string | null>(null)
  const updateDetectedRef = useRef(false)
  const noticeShownRef = useRef(false)

  const showReloadNotice = useCallback(() => {
    if (noticeShownRef.current) return
    noticeShownRef.current = true
    addNotice({
      description: 'Tap to reload and get the latest version.',
      kind: 'info',
      message: 'A new version is available',
    })
  }, [addNotice])

  // Poll for version changes
  useEffect(() => {
    if (noticeShownRef.current) return

    const check = async () => {
      const remote = await fetchRemoteVersion()
      if (!remote) return
      if (!knownVersionRef.current) {
        knownVersionRef.current = remote
        return
      }
      if (remote !== knownVersionRef.current) {
        updateDetectedRef.current = true
      }
    }

    void check()
    const id = setInterval(() => void check(), pollingIntervalMs)
    return () => clearInterval(id)
  }, [pollingIntervalMs])

  // Show notice when update detected and view is not suppressed
  useEffect(() => {
    if (!updateDetectedRef.current || noticeShownRef.current) return
    const isSuppressed = currentView != null && suppressWhileViews.includes(currentView)
    if (!isSuppressed) {
      showReloadNotice()
    }
  }, [currentView, showReloadNotice, suppressWhileViews])
}
```

- [ ] **Step 2: Export the hook from the shared hooks barrel**

Add to `abroad-ui/src/shared/hooks/index.ts`:

```typescript
export { useVersionCheck } from './useVersionCheck'
```

- [ ] **Step 3: Commit**

```bash
git add abroad-ui/src/shared/hooks/useVersionCheck.ts abroad-ui/src/shared/hooks/index.ts
git commit -m "feat: add useVersionCheck hook for new-version polling"
```

---

### Task 3: Wire up the hook in WebSwap

**Files:**
- Modify: `abroad-ui/src/pages/WebSwap/WebSwap.tsx`

- [ ] **Step 1: Add the hook call inside the WebSwap component**

At the top of the `WebSwap` component (after `const controller = useWebSwapController()` on line 79), add:

```typescript
useVersionCheck({
  currentView: controller.view,
  suppressWhileViews: ['txStatus', 'wait-sign'],
})
```

And add the import at the top of the file:

```typescript
import { useVersionCheck } from '../../shared/hooks'
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd abroad-ui && npx tsc --noEmit`

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add abroad-ui/src/pages/WebSwap/WebSwap.tsx
git commit -m "feat: wire up version check in WebSwap component"
```

---

### Task 4: Add reload action to the notice

**Files:**
- Modify: `abroad-ui/src/shared/types/notice.ts`
- Modify: `abroad-ui/src/shared/components/NoticeCenter.tsx`

- [ ] **Step 1: Add optional `onAction` to the Notice type**

In `abroad-ui/src/shared/types/notice.ts`, add an `onAction` field:

```typescript
export interface Notice {
  actionLabel?: string
  description?: string
  id: string
  kind: NoticeKind
  message: string
  onAction?: () => void
}
```

- [ ] **Step 2: Render the action button in NoticeCenter**

In `abroad-ui/src/shared/components/NoticeCenter.tsx`, add a clickable action button after the description. Replace the inner `<div className="flex-1">` block (lines 33-37) with:

```typescript
<div className="flex-1">
  <p className="font-semibold leading-tight">{notice.message}</p>
  {notice.description && (
    <p className="text-sm opacity-80 mt-0.5">{notice.description}</p>
  )}
  {notice.onAction && (
    <button
      className="text-sm font-medium underline mt-1"
      onClick={notice.onAction}
      type="button"
    >
      {notice.actionLabel ?? 'Reload'}
    </button>
  )}
</div>
```

- [ ] **Step 3: Update the hook to pass onAction**

In `abroad-ui/src/shared/hooks/useVersionCheck.ts`, update `showReloadNotice` to include the reload action:

```typescript
const showReloadNotice = useCallback(() => {
  if (noticeShownRef.current) return
  noticeShownRef.current = true
  addNotice({
    actionLabel: 'Reload',
    description: 'Tap reload to get the latest version.',
    kind: 'info',
    message: 'A new version is available',
    onAction: () => window.location.reload(),
  })
}, [addNotice])
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd abroad-ui && npx tsc --noEmit`

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add abroad-ui/src/shared/types/notice.ts abroad-ui/src/shared/components/NoticeCenter.tsx abroad-ui/src/shared/hooks/useVersionCheck.ts
git commit -m "feat: add reload action button to version update notice"
```

---

### Task 5: Write tests for useVersionCheck

**Files:**
- Create: `abroad-ui/src/shared/hooks/__tests__/useVersionCheck.test.ts`

- [ ] **Step 1: Create the test file**

Create `abroad-ui/src/shared/hooks/__tests__/useVersionCheck.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { useVersionCheck } from '../useVersionCheck'

// Mock NoticeContext
const mockAddNotice = vi.fn()
vi.mock('../../../contexts/NoticeContext', () => ({
  useNotices: () => ({ addNotice: mockAddNotice, clearNotices: vi.fn(), removeNotice: vi.fn() }),
}))

describe('useVersionCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockAddNotice.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not show a notice on first load', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: 'abc123' }), { status: 200 }),
    )

    renderHook(() => useVersionCheck({ pollingIntervalMs: 1000 }))
    await act(() => vi.advanceTimersByTimeAsync(100))

    expect(mockAddNotice).not.toHaveBeenCalled()
  })

  it('shows a notice when version changes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v2' }), { status: 200 }))

    renderHook(() => useVersionCheck({ currentView: 'swap', pollingIntervalMs: 1000 }))

    // First fetch sets baseline
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(mockAddNotice).not.toHaveBeenCalled()

    // Second fetch detects change
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(mockAddNotice).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'info', message: 'A new version is available' }),
    )
  })

  it('suppresses notice during txStatus view', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v2' }), { status: 200 }))

    const { rerender } = renderHook(
      ({ view }) => useVersionCheck({ currentView: view, pollingIntervalMs: 1000, suppressWhileViews: ['txStatus'] }),
      { initialProps: { view: 'txStatus' } },
    )

    await act(() => vi.advanceTimersByTimeAsync(100))
    await act(() => vi.advanceTimersByTimeAsync(1000))

    // Should be suppressed
    expect(mockAddNotice).not.toHaveBeenCalled()

    // Navigate away from txStatus
    rerender({ view: 'swap' })
    expect(mockAddNotice).toHaveBeenCalledTimes(1)
  })

  it('ignores fetch failures silently', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    renderHook(() => useVersionCheck({ pollingIntervalMs: 1000 }))
    await act(() => vi.advanceTimersByTimeAsync(100))

    expect(mockAddNotice).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `cd abroad-ui && npx vitest run src/shared/hooks/__tests__/useVersionCheck.test.ts`

Expected: 4 tests pass

- [ ] **Step 3: Commit**

```bash
git add abroad-ui/src/shared/hooks/__tests__/useVersionCheck.test.ts
git commit -m "test: add useVersionCheck hook tests"
```

---

### Task 6: Full build verification

- [ ] **Step 1: Run full TypeScript check**

Run: `cd abroad-ui && npx tsc --noEmit`

Expected: no errors

- [ ] **Step 2: Run full test suite**

Run: `cd abroad-ui && npx vitest run`

Expected: all tests pass

- [ ] **Step 3: Run a production build and verify version.json**

Run: `cd abroad-ui && npm run build && cat dist/version.json`

Expected: `{"version":"<16-char-hex>"}` and build succeeds

- [ ] **Step 4: Commit any remaining changes (if needed)**

If all green, the feature is complete and ready for deploy.
