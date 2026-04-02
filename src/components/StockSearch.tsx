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
    return ticker;
  };

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
        const data = await response.json();
        setResults(data.quotes || []);
        setIsOpen(true);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative w-full max-w-md" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stocks..."
          className="w-full pl-10 pr-4 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <Search className="absolute left-3 top-2.5 h-5 w-5 text-zinc-400" />
        {loading && <Loader2 className="absolute right-3 top-2.5 h-5 w-5 text-zinc-400 animate-spin" />}
      </div>
      {isOpen && results.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((result, index) => (
            <li
              key={`${result.symbol}-${index}`}
              className="px-4 py-2 hover:bg-zinc-100 cursor-pointer"
              onClick={() => {
                onSelect(result.symbol);
                setQuery('');
                setIsOpen(false);
              }}
            >
              <div className="font-semibold">{formatTicker(result.symbol)}</div>
              <div className="text-sm text-zinc-500">{result.shortname} ({result.exchange})</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
