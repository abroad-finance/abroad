/**
 * Translation versions for swap page titles (swap.page_title_brl, swap.page_title_cop).
 * Used as fallbacks per language when Tolgee backend has no translation for the key.
 */

export type SwapPageTitleLang = 'en' | 'es' | 'pt' | 'ru'

export const swapPageTitleBrl: Record<SwapPageTitleLang, string> = {
  en: 'Send to a Pix key',
  es: 'Enviar a una llave Pix',
  pt: 'Enviar para uma chave Pix',
  ru: 'Отправить на ключ Pix',
}

export const swapPageTitleCop: Record<SwapPageTitleLang, string> = {
  en: 'Send to a Bre-b key',
  es: 'Enviar a una llave Bre-b',
  pt: 'Enviar para uma chave Bre-b',
  ru: 'Отправить на ключ Bre-b',
}

export function getSwapPageTitleDefault(
  lang: string | undefined,
  currency: 'brl' | 'cop',
): string {
  const safeLang = (lang && (lang in swapPageTitleBrl) ? lang : 'en') as SwapPageTitleLang
  return currency === 'brl' ? swapPageTitleBrl[safeLang] : swapPageTitleCop[safeLang]
}
