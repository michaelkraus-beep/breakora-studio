import React from 'react';
import { cn } from '../../lib/utils';
import { Zap, Activity, Cpu } from 'lucide-react';

export interface WikiArticleMeta {
  slug: string;
  title: string;
  category: string;
}

interface HexWikiNavProps {
  articles: WikiArticleMeta[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
}

const HEX_CLIP_WIDE = 'polygon(12% 0%, 88% 0%, 100% 50%, 88% 100%, 12% 100%, 0% 50%)';
const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';

export function HexWikiNav({ articles, activeSlug, onSelect }: HexWikiNavProps) {
  // Group by category
  const categories = React.useMemo(() => {
    const map = new Map<string, WikiArticleMeta[]>();
    for (const a of articles) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category)!.push(a);
    }
    return map;
  }, [articles]);

  const getCategoryColor = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'core': return '#22D3EE';
      case 'technical': return '#A855F7';
      default: return '#10B981';
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'core': return <Activity size={10} />;
      case 'technical': return <Cpu size={10} />;
      default: return <Zap size={10} />;
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 border-r border-zinc-800/60 bg-[#060608] min-w-[200px] w-1/4 max-w-[280px] shrink-0 overflow-y-auto no-scrollbar">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="text-cyan-400" size={14} />
        <h3 className="text-xs font-bold font-sci-fi tracking-widest text-zinc-300">WIKI.INDEX</h3>
      </div>

      {Array.from(categories.entries()).map(([cat, catsArticles]) => {
        const color = getCategoryColor(cat);
        const icon = getCategoryIcon(cat);

        return (
          <div key={cat} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 opacity-80">
              <div className="w-5 h-5 flex items-center justify-center" style={{ clipPath: HEX_CLIP, background: `${color}20` }}>
                <span style={{ color }}>{icon}</span>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-400">{cat}</span>
            </div>

            <div className="flex flex-col gap-1.5 pl-3 border-l-2 border-zinc-800/60 ml-2">
              {catsArticles.map(a => {
                const isActive = a.slug === activeSlug;
                return (
                  <button
                    key={a.slug}
                    onClick={() => onSelect(a.slug)}
                    className="text-left px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-wider transition-all"
                    style={{
                      clipPath: HEX_CLIP_WIDE,
                      background: isActive ? `${color}18` : 'rgba(24, 24, 27, 0.4)',
                      color: isActive ? color : '#71717A',
                      boxShadow: isActive ? `0 0 12px ${color}25` : 'none',
                    }}
                  >
                    {a.title}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
