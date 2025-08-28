import React from 'react'

import { ATTRIBUTION_URL } from '../webSwap.constants'

type Props = {
  className?: string
  currency?: string // 'COP' | 'BRL'
}

const ImageAttribution: React.FC<Props> = ({ className, currency }) => {
  const isBRL = currency === 'BRL'

  const creditText = isBRL
    ? 'Cumbuco, Brasil by Otávio Nogueira, CC BY 2.0'
    : 'Rio Guayabero, Colombia by Pedro Szekely, CC BY-SA 2.0'

  const creditUrl = isBRL
    ? 'https://www.flickr.com/photos/55953988@N00/6193481566'
    : ATTRIBUTION_URL

  const handleClick = () => window.open(creditUrl, '_blank')

  return (
    <button
      className={`
        bg-black/40 text-white text-xs font-sans p-2 px-3 rounded-md
        backdrop-blur-md border border-white/10 cursor-pointer 
        transition-all duration-200 ease-out select-none
        hover:bg-black/50 hover:scale-102 active:scale-100
        ${className}
      `}
      onClick={handleClick}
    >
      {creditText}
    </button>
  )
}

export default ImageAttribution
