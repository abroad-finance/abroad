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
export const BRAND_TITLE_CLASS = 'text-emerald-700 font-cereal'

/** Shared theme classes to reduce duplicated lines (SonarCloud new_duplicated_lines_density). */
export const AB_STYLES = {
  badgeBg: 'bg-ab-badge-bg border border-ab-badge-border',
  borderBottomSeparator: 'border-b border-ab-separator',
  borderTopSeparator: 'border-t border-ab-separator',
  btnColor: 'text-ab-btn',
  cardBg: 'bg-ab-card border border-ab-card-border',
  cardBgOnly: 'bg-ab-card',
  hoverAndText: 'bg-ab-hover text-ab-text',
  hoverBg: 'bg-ab-hover',
  hoverBorder: 'bg-ab-hover border border-ab-separator',
  separatorBg: 'bg-ab-separator',
  text: 'text-ab-text',
  textMuted: 'text-ab-text-muted',
  textSecondary: 'text-ab-text-secondary',
} as const

export const PENDING_TX_KEY = 'pendingTransaction'

export const WALLET_CONNECT_ID = '5686074a7981cd147a5f0d7434a6d4b7'
