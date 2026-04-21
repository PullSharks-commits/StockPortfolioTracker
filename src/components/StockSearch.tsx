import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2 } from 'lucide-react';

interface SearchResult {
  symbol: string;
  shortname: string;
  exchange: string;
  typeDisp: string;
}

export const StockSearch = ({ onSelect, activeTab }: { onSelect: (ticker: string) => void, activeTab?: string }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const formatTicker = (ticker: string) => {
    if (activeTab === 'india') {
      return ticker.replace('.NS', '').replace('.BO', '');
    }
    if (activeTab === 'australia') {
      return ticker.replace('.AX', '');
    }
    return ticker;
  };

  useEffect(() => {
    if (activeTab && query === '') {
      // No-op
    }
  }, [activeTab]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const data = await response.json();
          let filtered = data.quotes || [];
          
          // Filter results based on active tab to help user find correct exchange
          if (activeTab === 'india') {
            filtered = filtered.filter((r: any) => r.symbol.endsWith('.NS') || r.symbol.endsWith('.BO') || r.exchange === 'NSI' || r.exchange === 'BSE');
          } else if (activeTab === 'australia') {
            filtered = filtered.filter((r: any) => r.symbol.endsWith('.AX') || r.exchange === 'ASX');
          }

          setResults(filtered);
          setIsOpen(true);
        } else {
          setResults([]);
        }
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, activeTab]);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder={activeTab === 'india' ? "Search Indian stocks..." : activeTab === 'australia' ? "Search Australian stocks..." : "Search stocks..."}
          className="w-full pl-10 pr-4 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent uppercase placeholder:normal-case"
        />
        <Search className="absolute left-3 top-2.5 h-5 w-5 text-zinc-400" />
        {loading && <Loader2 className="absolute right-3 top-2.5 h-5 w-5 text-zinc-400 animate-spin" />}
      </div>
      {isOpen && results.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((result, index) => (
            <li
              key={`${result.symbol}-${index}`}
              className="px-4 py-2 hover:bg-zinc-100 cursor-pointer border-b border-zinc-50 last:border-0"
              onClick={() => {
                onSelect(result.symbol);
                setQuery(result.symbol);
                setIsOpen(false);
              }}
            >
              <div className="flex justify-between items-center">
                <div className="font-semibold text-zinc-900">{result.symbol}</div>
                <div className="text-[10px] font-bold px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded uppercase">{result.exchange}</div>
              </div>
              <div className="text-xs text-zinc-500 truncate">{result.shortname}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
