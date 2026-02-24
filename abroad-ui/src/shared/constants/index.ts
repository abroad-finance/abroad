import type { CSSProperties } from 'react'

export const ATTRIBUTION_URL = 'https://www.flickr.com/photos/pedrosz/36132013403'

export const ASSET_URLS = {
  BACKGROUND_IMAGE: 'https://storage.googleapis.com/cdn-abroad/bg/36132013403_56c8daad31_3k.jpg',
  CELO_CHAIN_ICON: 'https://cryptologos.cc/logos/celo-celo-logo.svg',
  SOLANA_CHAIN_ICON: 'https://cryptologos.cc/logos/solana-sol-logo.svg',
  STELLAR_CHAIN_ICON: 'https://cryptologos.cc/logos/stellar-xlm-logo.svg',
  STELLAR_LOGO: 'https://storage.googleapis.com/cdn-abroad/Icons/Stellar/SCF_white.svg',
  USDC_TOKEN_ICON: 'https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg',
  USDT_TOKEN_ICON: 'https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDT-token.svg',
}

/** Shared style for brand title text (navbar, page title, language selector). Reduces duplication for SonarCloud. */
export const BRAND_TITLE_STYLE: CSSProperties = {
  color: 'var(--color-emerald-700)',
  fontFamily: '"Airbnb Cereal"',
}

/** Shared theme styles to reduce duplicated lines (SonarCloud new_duplicated_lines_density). */
export const AB_STYLES = {
  badgeBg: { background: 'var(--ab-badge-bg)', border: '1px solid var(--ab-badge-border)' } as CSSProperties,
  borderBottomSeparator: { borderBottom: '1px solid var(--ab-separator)' } as CSSProperties,
  borderTopSeparator: { borderTop: '1px solid var(--ab-separator)' } as CSSProperties,
  btnColor: { color: 'var(--ab-btn)' } as CSSProperties,
  cardBg: { background: 'var(--ab-card)', border: '1px solid var(--ab-card-border)' } as CSSProperties,
  cardBgOnly: { background: 'var(--ab-card)' } as CSSProperties,
  hoverAndText: { background: 'var(--ab-hover)', color: 'var(--ab-text)' } as CSSProperties,
  hoverBg: { background: 'var(--ab-hover)' } as CSSProperties,
  hoverBorder: { background: 'var(--ab-hover)', border: '1px solid var(--ab-separator)' } as CSSProperties,
  separatorBg: { background: 'var(--ab-separator)' } as CSSProperties,
  text: { color: 'var(--ab-text)' } as CSSProperties,
  textMuted: { color: 'var(--ab-text-muted)' } as CSSProperties,
  textSecondary: { color: 'var(--ab-text-secondary)' } as CSSProperties,
} as const

export const PENDING_TX_KEY = 'pendingTransaction'

export const WALLET_CONNECT_ID = '5686074a7981cd147a5f0d7434a6d4b7'
