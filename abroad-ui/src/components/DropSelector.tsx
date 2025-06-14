interface SelectorProps {
  imageSrc: string;
  text: string;
  onClick: () => void;
}

export function Selector({ imageSrc, text, onClick }: SelectorProps) {
  return (
    <div
      className="flex items-center p-4 border-b cursor-pointer hover:bg-gray-100"
      onClick={onClick}
    >
      <img
        src={imageSrc}
        alt={text}
        className="w-10 h-10 rounded-full mr-4 object-cover"
      />
      <span className="text-gray-700 text-lg font-medium">{text}</span>
    </div>
  );
}