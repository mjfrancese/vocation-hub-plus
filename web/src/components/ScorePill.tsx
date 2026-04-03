'use client';

interface ScorePillProps {
  score: number;
  onClick?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export default function ScorePill({ score, onClick, onMouseEnter, onMouseLeave }: ScorePillProps) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200 cursor-help ml-1"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {score}
    </span>
  );
}
