interface BalanceCardProps {
  imageSrc?: string;
  /** Optional small overlay image source */
  overlaySrc?: string;
  title: string;
  subtitle: string;
  value: number;
  /** Optional account identifier to display */
  accountId?: string;
}

export function BalanceCard({ imageSrc, overlaySrc, title, subtitle, value, accountId }: BalanceCardProps) {
  return (
    <div className="relative bg-white rounded-lg p-4 flex flex-col sm:flex-row items-center shadow-md hover:shadow-xl transition-shadow">
      {/* account ID badge */}
      {accountId && (
        <div className="absolute top-2 right-2 bg-gray-200 text-xs text-gray-700 rounded px-2 py-1">
          {accountId}
        </div>
      )}
      {/* image placeholder or provided image */}
      <div className="flex-shrink-0 relative w-16 h-16 bg-gray-200 rounded-full">
        {/* small overlay placeholder with optional image outside main circle */}
        <div className="absolute -top-2 -left-2 w-8 h-8 bg-gray-200 rounded-full overflow-hidden border-2 border-white">
          {overlaySrc && (
            <img src={overlaySrc} alt="overlay" className="w-full h-full object-cover" />
          )}
        </div>
        {imageSrc && (
          <img src={imageSrc} alt={title} className="w-full h-full object-cover" />
        )}
      </div>
      <div className="mt-4 sm:mt-0 sm:ml-4 text-center sm:text-left">
        <h3 className="text-lg font-semibold text-gray-700">{title}</h3>
        <h4 className="-mt-1 text-sm font-medium bg-gradient-to-r from-green-700 to-green-200 text-transparent bg-clip-text">{subtitle}</h4>
        <p className="mt-1 text-2xl font-bold text-gray-700">
          {value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </p>
      </div>
    </div>
  );
}