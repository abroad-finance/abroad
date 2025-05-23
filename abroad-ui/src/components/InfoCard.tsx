export interface InfoCardProps {
  /** Main title */
  title: string;
  /** Optional background color or gradient */
  background?: string;
  /** Optional circular image URL */
  imageSrc?: string;
  /** Additional tailwind classes */
  className?: string;
}

export function InfoCard({ title, background, imageSrc, className = '' }: InfoCardProps) {
  return (
    <div
      className={`relative rounded-lg p-4 flex items-center text-left shadow-md hover:shadow-xl transition-shadow ${className}`}
      style={
        background
          ? { backgroundImage: `url(${background})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : undefined
      }
    >
      <h3 className="flex-1 pr-4 text-xl font-semibold text-white text-center">{title}</h3>
      <div className="flex-shrink-0 basis-1/4 aspect-square rounded-full overflow-hidden">
        {imageSrc && <img src={imageSrc} alt={title} className="w-full h-full object-cover" />}
      </div>
    </div>
  );
}