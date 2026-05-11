export default function UnavailableInRegion() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F1EA] text-[#1B2A2E] p-6">
      <div className="max-w-md w-full rounded-2xl border border-[#356E6A]/15 bg-white p-8 shadow-sm text-center">
        <span className="inline-block px-2.5 py-1 rounded-full bg-[#356E6A]/10 text-[#356E6A] text-xs font-semibold tracking-wider uppercase mb-4">
          451 · Unavailable
        </span>
        <h1 className="text-xl font-semibold text-[#356E6A] mb-3">
          Abroad is not available in your region
        </h1>
        <p className="text-sm leading-relaxed mb-3">
          We&apos;re sorry — access to Abroad is currently restricted in your country.
        </p>
        <p className="text-sm text-[#5B6A6E]">
          If you believe this is a mistake, please reach out at
          {' '}
          <a className="font-semibold text-[#356E6A] hover:underline" href="https://abroad.finance">
            abroad.finance
          </a>
          .
        </p>
      </div>
    </div>
  )
}
