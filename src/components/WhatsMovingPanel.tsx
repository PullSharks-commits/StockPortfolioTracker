// "What's moving?" for one holding: today's move against the market and its sector,
// the latest headlines, and the user's AI model explaining the move from those
// headlines (shown as soon as they load; the explanation follows).

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { ExternalLink, Loader2, Newspaper, RefreshCw, TrendingDown, TrendingUp, X } from 'lucide-react';

export interface MoveArticle { title: string; summary: string; source: string; url: string; time: string }
export interface MoveData {
  symbol: string; name: string; marketState: string;
  price: number | null; previousClose: number | null; changePercent: number | null;
  market: { symbol: string; name: string; changePercent: number | null } | null;
  sector: { name: string; etf: string | null; changePercent: number | null } | null;
  articles: MoveArticle[]; recentCount: number; asOf: string;
}
export interface AiAnswer { text: string; model?: string; fallbackNotice?: string }

const SESSION: Record<string, string> = { PRE: 'pre-market', PREPRE: 'pre-market', POST: 'after hours', POSTPOST: 'after hours', CLOSED: 'last session' };
const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export function buildMovePrompt(d: MoveData): string {
  const lines = d.articles.map((a, i) => `${i + 1}. [${a.time.slice(0, 16).replace('T', ' ')} UTC, ${a.source}] ${a.title}${a.summary ? ` — ${a.summary.slice(0, 300)}` : ''}`);
  return `${d.name} (${d.symbol}) is ${fmtPct(d.changePercent)} ${SESSION[d.marketState] ? `(${SESSION[d.marketState]})` : 'today'}${d.price != null ? `, at ${d.price}` : ''}.
${d.market ? `Market context: ${d.market.name} ${fmtPct(d.market.changePercent)}.` : ''}
${d.sector?.etf ? `Sector context: ${d.sector.name} (${d.sector.etf}) ${fmtPct(d.sector.changePercent)}.` : d.sector ? `Sector: ${d.sector.name}.` : ''}

${d.recentCount ? `Headlines from the last 48 hours (newest first):` : `No company headlines in the last 48 hours. The latest older ones:`}
${lines.join('\n') || '(none)'}

Explain why ${d.symbol} is ${d.changePercent != null && d.changePercent < 0 ? 'down' : 'up'} today, for an investor who holds it.
- Lead with the single most likely driver in one sentence, in bold.
- Then 2–4 short bullets: the supporting news (cite the headline number like [3]), and whether the move is company-specific or just tracking the market/sector (compare the numbers above).
- If the headlines don't explain the move, say so plainly rather than guessing; a small move in line with the market needs no story.
- Ignore generic listicles ("3 stocks to buy...") unless they report actual news.
Keep it under 150 words. No preamble.`;
}

export function WhatsMovingPanel({ ticker, onClose, explain, modelLabel }: {
  ticker: string;
  onClose: () => void;
  explain: (prompt: string) => Promise<AiAnswer>;
  modelLabel: string;
}) {
  const [data, setData] = useState<MoveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);

  const runAi = async (d: MoveData) => {
    setThinking(true); setAiError(null); setAnswer(null);
    try { setAnswer(await explain(buildMovePrompt(d))); }
    catch (e) { setAiError(e instanceof Error ? e.message : String(e)); }
    finally { setThinking(false); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/whats-moving?symbol=${encodeURIComponent(ticker)}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.details || body.error || 'Failed to load');
        if (cancelled) return;
        setData(body);
        runAi(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const up = (data?.changePercent ?? 0) >= 0;
  const tone = (n: number | null | undefined) => (n == null ? 'text-zinc-500' : n >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');

  return createPortal(
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 p-3 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`What's moving ${ticker}`}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">What's moving {ticker}?</h3>
            {data && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className={`inline-flex items-center gap-1 font-semibold ${tone(data.changePercent)}`}>
                  {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {fmtPct(data.changePercent)}{SESSION[data.marketState] ? ` ${SESSION[data.marketState]}` : ' today'}
                </span>
                {data.market && <span className="text-zinc-500">{data.market.name} <span className={tone(data.market.changePercent)}>{fmtPct(data.market.changePercent)}</span></span>}
                {data.sector?.etf && <span className="text-zinc-500">{data.sector.name} <span className={tone(data.sector.changePercent)}>{fmtPct(data.sector.changePercent)}</span></span>}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-700 rounded-lg shrink-0" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!data && !error && <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading today's news…</div>}

          {data && (
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Why it's moving</h4>
                {!thinking && (
                  <button onClick={() => runAi(data)} className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-indigo-600" title="Ask again">
                    <RefreshCw className="w-3 h-3" /> Ask again
                  </button>
                )}
              </div>
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/60 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200">
                {thinking && <div className="flex items-center gap-2 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /> Asking {modelLabel}… (local models can take a minute)</div>}
                {aiError && <p className="text-rose-600">{aiError}</p>}
                {answer && (
                  <div className="space-y-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_p]:my-1">
                    <ReactMarkdown>{answer.text}</ReactMarkdown>
                    <p className="!mt-2 text-[10px] text-zinc-400">
                      {answer.model || modelLabel}, from the headlines below{answer.fallbackNotice ? ` · ${answer.fallbackNotice}` : ''}. Can be wrong; check the sources.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {data && (
            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center gap-1.5">
                <Newspaper className="w-3.5 h-3.5" />
                {data.recentCount ? 'Headlines, last 48 hours' : 'No headlines in the last 48 hours; latest older ones'}
              </h4>
              {data.articles.length === 0 && <p className="text-sm text-zinc-500">No recent news found for {ticker}.</p>}
              <ol className="space-y-2">
                {data.articles.map((a, i) => (
                  <li key={a.url || a.title} className="flex gap-2 text-sm">
                    <span className="text-zinc-400 tabular-nums text-xs pt-0.5 w-5 shrink-0 text-right">{i + 1}.</span>
                    <div className="min-w-0">
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-zinc-800 dark:text-zinc-100 hover:text-indigo-600 hover:underline">
                        {a.title}<ExternalLink className="inline w-3 h-3 ml-1 opacity-50" />
                      </a>
                      <div className="text-[11px] text-zinc-400">{a.source} · {ago(a.time)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
