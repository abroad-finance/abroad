# Abroad MiniPay Discover Submission Notes

Last updated: March 7, 2026

## App Identity

- App name: `Abroad`
- Operator: `Abroad`
- MiniPay disclosure copy in app: `Operated by Abroad, not Opera or MiniPay.`
- Support URL: [https://www.abroad.finance/contact-us](https://www.abroad.finance/contact-us)
- Terms of Service: [https://www.abroad.finance/terms-of-service](https://www.abroad.finance/terms-of-service)
- Privacy Policy: [https://www.abroad.finance/privacy-policy](https://www.abroad.finance/privacy-policy)

## Domains And Subdomains

- Primary app host referenced in the UI wallet metadata: `app.abroad.finance`
- Additional production hosts already referenced in the frontend: `abroad.finance`, `www.abroad.finance`
- Preview hosts should not be submitted to Opera. Only submit the final production MiniPay host after deployment confirmation.

## Onchain Surface For MiniPay Users

MiniPay users do not interact with a custom Abroad contract in the current flow.

They only submit standard ERC-20 transfers on Celo:

- `USDC.transfer(address to, uint256 value)`
- `USDT.transfer(address to, uint256 value)`

Contract references used for MiniPay support:

- USDC on Celo: [0x37f750B7Cc259a2f741Af45294f6a16572CF5cAd](https://celoscan.io/token/0x37f750B7Cc259a2f741Af45294f6a16572CF5cAd)
- USDT on Celo: [0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e](https://celoscan.io/token/0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e)
- cUSD balance detection only: [0x765DE816845861e75A25fCA122bb6898B8B1282a](https://celoscan.io/token/0x765DE816845861e75A25fCA122bb6898B8B1282a)

## Celoscan Samples To Fill After QA

- USDC payment transfer sample: `TODO`
- USDT payment transfer sample: `TODO`
- Low-balance/Add Cash test capture: `TODO`

## MiniPay Branding Assets

Current repo assets that can be exported for Opera submission:

- App logo: [abroad-ui/src/assets/Logos/AbroadLogoColored.svg](/Users/hollwann/Documents/GitHub/abroad-git/abroad/abroad-ui/src/assets/Logos/AbroadLogoColored.svg)
- Alternate logo: [abroad-ui/src/assets/Logos/AbroadLogoWhite.svg](/Users/hollwann/Documents/GitHub/abroad-git/abroad/abroad-ui/src/assets/Logos/AbroadLogoWhite.svg)

Still required before final submission:

- Discover icon export sized for Opera submission
- Discover banner export sized for Opera submission

## Implementation Notes

- MiniPay mode detects `window.ethereum.isMiniPay` and auto-reads the wallet address without showing a Connect button.
- MiniPay mode does not use wallet-auth challenge signing.
- MiniPay mode hides wallet addresses, copy actions, explorer links, wallet disconnect actions, and transaction history.
- MiniPay mode limits corridors to Celo and prefers the supported stablecoin with the highest balance between USDC and USDT.
- If cUSD is the user’s highest balance, the app shows a graceful explanation and links to MiniPay Add Cash: [https://minipay.opera.com/add_cash](https://minipay.opera.com/add_cash)

## Final Submission Checklist

- Confirm the final production MiniPay host to submit to Opera.
- Capture one successful USDC transfer hash on Celo.
- Capture one successful USDT transfer hash on Celo.
- Export the Discover icon and banner assets.
- Verify the production backend token configuration matches the Celo contracts above.
