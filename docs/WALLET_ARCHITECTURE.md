# Wallet Architecture Documentation

## Overview

This document describes the wallet connection architecture for the Abroad platform, which supports multiple wallet types across different blockchain networks including Stellar, Celo (Ethereum), and Solana.

## Supported Wallets

| Wallet Type | Networks | Implementation | Status |
|-------------|----------|----------------|--------|
| MiniPay | Celo (eip155:42220) | `useMiniPayWallet.ts` | ✅ Complete |
| StellarKit (Freighter, LOBSTR, etc.) | Stellar | `useStellarKitWallet.ts` | ✅ Complete |
| WalletConnect | Multi-chain | `useWalletConnectWallet.ts` | ✅ Complete |
| Solana Native | Solana | `useSolanaWallet.ts` | ✅ Complete |
| SEP-24 | Stellar | `useSep24Wallet.ts` | ✅ Complete |

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    WalletAuthProvider                       │
│  - Manages wallet lifecycle                                 │
│  - Handles session restoration on mount                     │
│  - Provides wallet context to app                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     useWalletFactory                        │
│  - Factory pattern for wallet creation                      │
│  - Routes to appropriate wallet handler                     │
│  - Supports: mini-pay, stellar-kit, wallet-connect,         │
│              solana, sep24                                  │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ useMiniPay    │   │ useStellarKit   │   │ useWalletConnect│
│ Wallet        │   │ Wallet          │   │ Wallet          │
└───────────────┘   └─────────────────┘   └─────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Shared Utilities Layer                         │
│  - wallet-connect-base.ts                                   │
│    • WC_METADATA (shared metadata)                          │
│    • saveWCSession / getWCSession / clearWCSession          │
│    • resolveNamespaceFromChainId                            │
│    • toBase64 / fromBase64                                  │
│  - wallet-utils.ts                                          │
│    • caip10ToAddress                                        │
│    • normalizeAddress                                       │
│    • getNamespaceFromChainId                                │
│    • isValidAddressForChain                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Session Persistence                      │
│  - sessionStore.ts                                          │
│    • get() / set() / clear()                                │
│    • isValid() - validates address format & expiration      │
│    • 24-hour session expiration                             │
└─────────────────────────────────────────────────────────────┘
```

## Connection Flows

### Flow 1: MiniPay (Celo)

```
User opens app on mobile with MiniPay installed
           │
           ▼
┌─────────────────────────┐
│ getWalletTypeByDevice() │
│ Detects window.ethereum │
│ .isMiniPay = true       │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ useMiniPayWallet        │
│ Requests eth_accounts   │
│ permission              │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ WalletAuth              │
│ authenticate()          │
│ - Get challenge from    │
│   backend               │
│ - Sign with MiniPay     │
│ - Exchange for JWT      │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ sessionStore.set()      │
│ {address, chainId,      │
│  walletId, timestamp}   │
└─────────────────────────┘
```

### Flow 2: StellarKit (Freighter, LOBSTR, Albedo, etc.)

```
User clicks "Connect Wallet"
           │
           ▼
┌─────────────────────────┐
│ kit.openModal()         │
│ Shows Stellar wallet    │
│ selector modal          │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ User selects wallet     │
│ (e.g., Freighter)       │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ kit.getAddress()        │
│ Returns {address}       │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ walletAuth.authenticate │
│ ()                      │
│ - Sign challenge with   │
│   kit.signTransaction() │
│ - Exchange for JWT      │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ sessionStore.set()      │
│ Persist session         │
└─────────────────────────┘
```

### Flow 3: WalletConnect (QR Code)

```
User selects "WalletConnect"
           │
           ▼
┌─────────────────────────┐
│ SignClient.init()       │
│ Initialize WC client    │
│ with metadata           │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ client.connect()        │
│ Returns {uri, approval} │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ modal.openModal({uri})  │
│ Shows QR code           │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ User scans QR with      │
│ mobile wallet           │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ session.await()         │
│ Returns {topic}         │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ saveWCSession()         │
│ Persist {topic, address │
│  chains} to localStorage│
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ walletAuth.authenticate │
│ ()                      │
│ - Sign challenge via    │
│   WC request            │
│ - Exchange for JWT      │
└─────────────────────────┘
```

### Flow 4: Solana Native (Phantom, Solflare)

```
User selects "Connect Solana"
           │
           ▼
┌─────────────────────────┐
│ getSolanaProvider()     │
│ Detects window.phantom  │
│ or window.solana        │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ provider.connect()      │
│ Returns {publicKey}     │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ walletAuth.authenticate │
│ ()                      │
│ - Sign challenge with   │
│   provider.signMessage()│
│ - Exchange for JWT      │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ sessionStore.set()      │
│ Persist session         │
└─────────────────────────┘
```

### Flow 5: Session Restoration (Page Reload)

```
Page loads / WalletAuthProvider mounts
           │
           ▼
┌─────────────────────────┐
│ sessionStore.get()      │
│ Returns saved session   │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ sessionStore.isValid()  │
│ - Validate address      │
│   format for chain      │
│ - Check 24h expiration  │
└─────────────────────────┘
           │
           ▼
    ┌──────┴──────┐
    │   Valid?    │
    └──────┬──────┘
     Yes   │   No
     │     │      │
     │     └──────┘
     │       Clear session
     ▼
┌─────────────────────────┐
│ wallet.connect()        │
│ Reconnect with saved    │
│ chainId                 │
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│ Restore complete        │
│ User stays logged in    │
└─────────────────────────┘
```

## Error Handling

### Standardized Error Types

All wallet implementations use the standardized `WalletError` type:

```typescript
enum WalletErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  DISCONNECT_FAILED = 'DISCONNECT_FAILED',
  SIGNATURE_FAILED = 'SIGNATURE_FAILED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  CHAIN_NOT_SUPPORTED = 'CHAIN_NOT_SUPPORTED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  USER_REJECTED = 'USER_REJECTED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}

interface WalletError {
  code: WalletErrorCode
  message: string
  details?: unknown
  walletId?: string
  chainId?: string
}
```

### Error Handling Best Practices

1. **Always use `createWalletError()`** for consistent error reporting
2. **Include chainId and walletId** when available for debugging
3. **Condition console.error to DEV mode only**
4. **Send production errors to Sentry**

## Session Validation

The `sessionStore.isValid()` method performs these checks:

1. **Address format validation** based on chain type:
   - EVM (eip155): `0x` prefix, 42 characters
   - Solana: Base58, 32-44 characters
   - Stellar: `G` or `S` prefix, 56 characters

2. **Timestamp expiration**: Sessions expire after 24 hours

3. **Wallet ID validation**: Must match a valid `WalletType`

## Key Design Decisions

### 1. Shared WalletConnect Utilities

**Problem:** `useWalletConnectWallet.ts` and `useStellarKitWallet.ts` had duplicated code for:
- CAIP-10 address parsing
- WC metadata
- Session storage logic

**Solution:** Created `wallet-connect-base.ts` and `wallet-utils.ts` with shared utilities.

### 2. Session Persistence

**Problem:** Users had to reconnect wallets on every page reload.

**Solution:** Implemented `sessionStore` with:
- Automatic session restoration in `WalletAuthProvider`
- Address format validation
- 24-hour expiration

### 3. Wallet Detection

**Problem:** `getWalletTypeByDevice()` didn't consider existing sessions or MiniPay.

**Solution:** Updated priority order:
1. MiniPay detection (highest priority)
2. Existing session walletId
3. Device-based fallback (mobile → WC, desktop → Stellar)

### 4. Solana Native Support

**Problem:** Solana was only available via WalletConnect.

**Solution:** Created `useSolanaWallet.ts` with:
- Phantom, Solflare, Backpack detection
- Native connection flow
- Consistent IWallet interface

## File Structure

```
src/
├── interfaces/
│   ├── IWallet.ts              # Core wallet interface
│   ├── IWalletFactory.ts       # Factory interface + WalletType
│   ├── wallet-errors.ts        # Standardized error types
│   └── wallet-types.ts         # Chain info, connection state types
├── services/
│   ├── useWalletFactory.ts     # Wallet factory implementation
│   ├── auth/
│   │   └── sessionStore.ts     # Session persistence + validation
│   └── wallets/
│       ├── useMiniPayWallet.ts
│       ├── useStellarKitWallet.ts
│       ├── useWalletConnectWallet.ts
│       ├── useSolanaWallet.ts
│       ├── useSep24Wallet.ts
│       └── shared/
│           ├── wallet-connect-base.ts  # Shared WC utilities
│           └── wallet-utils.ts         # General wallet utilities
└── contexts/
    └── WalletAuthProvider.tsx  # Provider with session restoration
```

## Testing

### Unit Tests

Run tests with:
```bash
npm test
```

### Manual Testing Checklist

- [ ] Connect MiniPay → verify persistence after reload
- [ ] Connect Freighter → verify persistence after reload
- [ ] Connect LOBSTR → verify persistence after reload
- [ ] Connect WalletConnect (QR) → verify Celo connection
- [ ] Connect WalletConnect (QR) → verify Solana connection
- [ ] Simulate connection error → verify standardized error message
- [ ] Verify `getWalletTypeByDevice()` prioritizes MiniPay
- [ ] Verify session expires after 24 hours
- [ ] Verify invalid session is cleared

## Migration Notes

### For New Wallet Implementations

1. **Implement the IWallet interface**
2. **Use shared utilities** from `wallet-connect-base.ts` and `wallet-utils.ts`
3. **Use `createWalletError()`** for error handling
4. **Persist sessions** using `sessionStore.set()`
5. **Add to WalletFactory** switch statement
6. **Add to WalletType** union type

### Deprecation Warnings

The following are deprecated and should not be used:
- Hardcoded WC metadata (use `WC_METADATA`)
- Duplicate `caip10ToAddress()` implementations
- Direct localStorage manipulation for sessions
