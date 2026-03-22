import React from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ContextualHelpProps {
  slug: string;
  className?: string;
  size?: number;
}

export function ContextualHelp({ slug, className, size = 14 }: ContextualHelpProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('open-wiki', { detail: { slug } }));
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "text-zinc-500 hover:text-cyan-400 transition-colors p-1 rounded-full outline-none",
        "hover:bg-cyan-400/10 hover:shadow-[0_0_8px_rgba(34,211,238,0.2)]",
        className
      )}
      title="Open Wiki Context"
    >
      <HelpCircle size={size} strokeWidth={2.5} />
    </button>
  );
}
