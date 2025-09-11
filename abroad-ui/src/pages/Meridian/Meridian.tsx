import { useTranslate } from '@tolgee/react'
// React import not required with the new JSX transform

import AbroadLogoWhite from '../../assets/Logos/AbroadLogoWhite.svg'
import BeansLogoWhite from '../../assets/Logos/Wallets/beans-white.svg'
import LobstrLogoWhite from '../../assets/Logos/Wallets/lobstr-white.svg'
import ZyptoLogoWhite from '../../assets/Logos/Wallets/zypto-white.svg'
import MeridianCard from '../../assets/meridian-card.png'

const walletOptions = [
  {
    name: 'abroad',
    onClick: () => { /* connect logic */ },
    src: AbroadLogoWhite,
  },
  {
    name: 'zypto',
    onClick: () => { /* connect logic */ },
    src: ZyptoLogoWhite,
  },
  {
    name: 'beans',
    onClick: () => window.open('https://www.beansapp.com/download', '_blank', 'noopener,noreferrer'),
    src: BeansLogoWhite,
  },
  {
    name: 'lobstr',
    onClick: () => window.open('https://lobstr.co/uni/wc/wc/', '_blank', 'noopener,noreferrer'),
    src: LobstrLogoWhite,
  },
]

const Meridian = () => {
  const { t } = useTranslate()
  return (
    <div className="bg-black h-full min-h-screen p-8 flex flex-col items-center justify-around">
      <div className="flex flex-row space-x-1 items-center text-white mb-8 self-start">
        <h1 className="text-center text-3xl font-extralight">
          {t('merian_landing.welcome_to', 'Bienvenido a')}
          {' '}
          <span className="text-[#F2CD00] font-semibold">{t('merian_landing.brazil', 'Brazil')}</span>
        </h1>
        <div className="bg-white p-1 flex items-center rounded-full">
          <img
            alt="brazil_flag"
            className="w-8 h-8"
            src="https://hatscripts.github.io/circle-flags/flags/br.svg"
          />
        </div>
      </div>

      <div className="relative w-full rounded-md mb-4 h-48 overflow-hidden">
        {/* blurred background layer */}
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center filter blur-[1px] scale-105 z-0"
          style={{ backgroundImage: `url(${MeridianCard})` }}
        />

        {/* foreground content (kept sharp) */}
        <div className="absolute top-3 left-3 text-white text-3xl drop-shadow z-10">
          <span className="font-extralight">{t('merian_landing.pay_with', 'Paga con')}</span>
          <br />
          <div className="flex items-center space-x-2 font-semibold">
            <span>USDC</span>
            <div className="bg-white p-1 w-8 h-8 flex items-center rounded-full">
              <img
                alt="usdc_symbol"
                className="w-8 h-8"
                src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
              />
            </div>
          </div>
        </div>
        <div className="absolute bottom-3 right-3 text-3xl text-white font-extralight drop-shadow text-right whitespace-pre-line z-10">
          {t('merian_landing.or_any_pix', 'En cualquier Pix')}
          <br />
          {t('merian_landing.qr_code', 'Código QR')}
        </div>
      </div>

      <div className="max-w-[400px] mr-auto mt-6 text-white text-xs font-extralight">
        <h2 className="text-left text-2xl font-extralight mb-3">
          {t('merian_landing.please_follow', 'Por favor siga estos')}
          {' '}
          <span className="text-[#F2CD00] font-semibold">{t('merian_landing.steps', 'pasos')}</span>
        </h2>
        <ul className="space-y-2 text-left">
          <li className="flex items-center justify-start gap-3">
            <span className="w-3 h-3 rounded-full bg-[#F2CD00]" />
            {t('merian_landing.pick_wallet', 'Pick your wallet and add USDC.')}
          </li>
          <li className="flex items-center justify-start gap-3">
            <span className="w-3 h-3 rounded-full bg-[#F2CD00]" />
            {t('merian_landing.open_our_app', 'Open our app inside the partner wallet.')}
          </li>
          <li className="flex items-center justify-start gap-3">
            <span className="w-3 h-3 rounded-full bg-[#F2CD00]" />
            {t('merian_landing.enter_payment', 'Scan any Pix QR or enter the payment key.')}
          </li>
          <li className="flex items-center justify-start gap-3">
            <span className="w-3 h-3 rounded-full bg-[#F2CD00]" />
            {t('merian_landing.enjoy_message', 'Enjoy great rates, instantly.')}
          </li>
        </ul>
      </div>

      {/* new subtitle before wallet buttons - same styles as the main h1, last word in yellow */}
      <div className="w-full my-4">
        <h1 className="text-center text-2xl font-extralight text-white">
          {t('merian_landing.select_your_favourite_wallet', 'Selecciona tu billetera favorita')}
          {' '}
          <span className="text-[#F2CD00] font-semibold">{t('merian_landing.to_continue', 'para continuar')}</span>
        </h1>
      </div>

      <div className="flex flex-wrap gap-4 mt-3 items-center justify-around">
        {walletOptions.map(wallet => (
          <button
            className="bg-[#0E0E0E] text-white w-5/12 md:w-40 h-18 rounded-lg border border-white border-b-2 cursor-pointer font-semibold p-2 overflow-hidden"
            key={wallet.name}
            onClick={wallet.onClick}
            type="button"
          >
            <img
              alt="Abroad"
              className="w-full"
              height={42}
              src={wallet.src}
              width={42}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

export default Meridian
