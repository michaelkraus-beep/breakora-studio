import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { HexWikiNav, WikiArticleMeta } from './HexWikiNav';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface WikiTabProps {
  initialSlug?: string | null;
}

export function WikiTab({ initialSlug }: WikiTabProps) {
  const [articles, setArticles] = useState<WikiArticleMeta[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(initialSlug || null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Expose setSlug to window so Layout can dynamically jump there
  useEffect(() => {
    const handleRemoteNav = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.slug) {
        setActiveSlug(customEvent.detail.slug);
      }
    };
    window.addEventListener('wiki-navigate', handleRemoteNav);
    return () => window.removeEventListener('wiki-navigate', handleRemoteNav);
  }, []);

  useEffect(() => {
    if (initialSlug) {
      setActiveSlug(initialSlug);
    }
  }, [initialSlug]);

  useEffect(() => {
    fetch('/api/wiki/index')
      .then(r => r.json())
      .then(data => {
        setArticles(data || []);
        if (!activeSlug && data && data.length > 0) {
          setActiveSlug(data[0].slug);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!activeSlug) return;
    setLoading(true);
    fetch(`/api/wiki/articles/${activeSlug}`)
      .then(r => r.json())
      .then(data => {
        if (data.content) setContent(data.content);
        else setContent('Article not found.');
      })
      .catch((e) => {
        console.error(e);
        setContent('Error loading article.');
      })
      .finally(() => setLoading(false));
  }, [activeSlug]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-zinc-950 font-sans text-zinc-300">
      <HexWikiNav articles={articles} activeSlug={activeSlug} onSelect={setActiveSlug} />
      
      <div className="flex-1 overflow-y-auto no-scrollbar p-8 relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.02]" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='56' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100' fill='none' stroke='%23ffffff' stroke-width='1'/%3E%3Cpath d='M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34' fill='none' stroke='%23ffffff' stroke-width='1'/%3E%3C/svg%3E")`,
            backgroundSize: '56px 100px'
        }} />
        
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="animate-spin text-cyan-500" size={32} />
          </div>
        ) : (
          <article className="prose prose-invert prose-cyan max-w-4xl mx-auto prose-h1:text-zinc-100 prose-h2:text-cyan-400 prose-h3:text-zinc-300 prose-code:text-cyan-300 prose-code:bg-cyan-950/30 prose-code:px-1 prose-code:rounded prose-a:text-cyan-400 marker:text-cyan-500">
            <ReactMarkdown>
              {content || '# Welcome to the Breakora Wiki\\nSelect an article from the left navigation.'}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}
