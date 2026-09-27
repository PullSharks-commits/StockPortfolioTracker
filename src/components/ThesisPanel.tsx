// Read-only view of a holding's thesis from the Thesis Tracker: the latest run's
// rating and reasoning, the thesis and its pillars, rating history and thesis log.
// Edit the thesis in the tracker's theses/<TICKER>.md; the app picks changes up.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, FileText, Loader2, X } from 'lucide-react';
import { authedFetch } from '../backend';
import { RATING_ACTION, RATING_EMOJI, fmtDay, type Rating, type TrackerHolding } from '../lib/thesisTracker';
import { RATING_DOT, ThesisBadge } from './ThesisBadge';

const md = {
  a: (p: any) => <a {...p} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline" />,
  ul: (p: any) => <ul {...p} className="list-disc pl-5 space-y-1" />,
  ol: (p: any) => <ol {...p} className="list-decimal pl-5 space-y-1" />,
  p: (p: any) => <p {...p} className="my-1" />,
  h1: (p: any) => <h3 {...p} className="text-base font-semibold mt-3" />,
  h2: (p: any) => <h4 {...p} className="text-sm font-semibold mt-4 mb-1" />,
  h3: (p: any) => <h5 {...p} className="text-sm font-semibold mt-3 mb-1" />,
  table: (p: any) => <div className="overflow-x-auto"><table {...p} className="text-xs my-2" /></div>,
  td: (p: any) => <td {...p} className="border border-zinc-200 dark:border-zinc-700 px-1.5 py-1 align-top" />,
  th: (p: any) => <th {...p} className="border border-zinc-200 dark:border-zinc-700 px-1.5 py-1 text-left" />,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">{title}</h4>
      <div className="text-sm text-zinc-700 dark:text-zinc-300">{children}</div>
    </section>
  );
}

export function ThesisPanel({ holding, onClose }: { holding: TrackerHolding; onClose: () => void }) {
  const [report, setReport] = useState<{ date: string; text: string } | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [report]);
  const t = holding.thesis;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openReport = async (date: string) => {
    setLoadingReport(true);
    try {
      const res: { date: string; markdown: string } = await authedFetch('GET', `/api/thesis-tracker/reports/${date}`);
      setReport({ date, text: res.markdown });
    } catch (err) {
      setReport({ date, text: `Couldn't load the report: ${err instanceof Error ? err.message : err}` });
    } finally {
      setLoadingReport(false);
    }
  };

  const history = [...holding.history].reverse();
  const strip = holding.history.slice(-90);

  // Portalled to <body>: an ancestor with a transform (the draggable widgets) would
  // otherwise turn `fixed` into "fixed to that widget" and clip the panel.
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-3" onMouseDown={onClose}>
      <div ref={scrollRef} className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 shadow-xl" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={`Thesis for ${holding.ticker}`}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-semibold">{holding.ticker}</h3>
              {holding.rating && <ThesisBadge rating={holding.rating} />}
              {holding.draft && <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">draft thesis</span>}
            </div>
            {t?.company && <p className="text-xs text-zinc-500 truncate">{t.company}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        {report ? (
          <div className="p-5">
            <button onClick={() => setReport(null)} className="text-xs text-indigo-600 hover:underline mb-3">← Back to {holding.ticker}</button>
            <div className="text-sm text-zinc-700 dark:text-zinc-300"><ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{report.text}</ReactMarkdown></div>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {holding.rating && (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                  <span>{holding.reportDate ? `Thesis Tracker run, ${fmtDay(holding.reportDate)}` : 'From the thesis file'}{holding.change && holding.change !== '→' ? ` · ${holding.change}` : ''}</span>
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">{RATING_EMOJI[holding.rating]} {RATING_ACTION[holding.rating]}</span>
                </div>
                {holding.reason && <div className="mt-1.5 text-sm text-zinc-800 dark:text-zinc-200"><ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{holding.reason}</ReactMarkdown></div>}
                {holding.detail && <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 border-t border-zinc-200 dark:border-zinc-800 pt-2"><ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{holding.detail}</ReactMarkdown></div>}
                {holding.reportDate && (
                  <button onClick={() => openReport(holding.reportDate!)} disabled={loadingReport} className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline">
                    {loadingReport ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} Full report for {fmtDay(holding.reportDate)}
                  </button>
                )}
              </div>
            )}

            {t?.oneLine && <Section title="Thesis"><p className="text-zinc-800 dark:text-zinc-200">{t.oneLine}</p></Section>}

            {t && t.pillars.length > 0 && (
              <Section title="Pillars (what must stay true)">
                <ol className="list-decimal pl-5 space-y-1">
                  {t.pillars.map((p, i) => <li key={i}>{p.name && <b>{p.name}</b>}{p.name ? ' — ' : ''}<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...md, p: (x: any) => <span {...x} /> }}>{p.text}</ReactMarkdown></li>)}
                </ol>
              </Section>
            )}

            {t && Object.keys(t.rubric).length > 0 && (
              <Section title="Rubric">
                <ul className="space-y-1">
                  {(['green', 'yellow', 'red'] as Rating[]).filter(r => t.rubric[r]).map(r => (
                    <li key={r} className="flex gap-2"><span>{RATING_EMOJI[r]}</span><span>{t.rubric[r]}</span></li>
                  ))}
                </ul>
              </Section>
            )}

            {history.length > 0 && (
              <Section title={`Rating history (${history.length} runs)`}>
                <div className="flex gap-0.5 flex-wrap mb-2" aria-label="Rating over time">
                  {strip.map(h => <span key={h.date} title={`${fmtDay(h.date)}: ${h.rating ?? '—'}`} className={`h-3 w-2 rounded-sm ${h.rating ? RATING_DOT[h.rating] : 'bg-zinc-300'}`} />)}
                </div>
                <ol className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 max-h-72 overflow-y-auto">
                  {history.map((h, i) => {
                    const older = history[i + 1];
                    const changed = older && older.rating !== h.rating;
                    return (
                      <li key={h.date} className={`px-3 py-2 flex gap-2 text-xs ${changed ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}>
                        <button onClick={() => openReport(h.date)} className="w-14 shrink-0 text-left text-zinc-500 hover:text-indigo-600" title="Open this report">{fmtDay(h.date)}</button>
                        <span className="shrink-0">{h.rating ? RATING_EMOJI[h.rating] : '—'}</span>
                        <span className="text-zinc-600 dark:text-zinc-400 min-w-0">{changed && <b className="text-zinc-700 dark:text-zinc-200">Changed. </b>}<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...md, p: (x: any) => <span {...x} /> }}>{h.reason}</ReactMarkdown></span>
                      </li>
                    );
                  })}
                </ol>
              </Section>
            )}

            {t && t.whyHold.length > 0 && (
              <Section title="Why I hold this">
                <ul className="list-disc pl-5 space-y-1">{t.whyHold.map((w, i) => <li key={i}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...md, p: (x: any) => <span {...x} /> }}>{w}</ReactMarkdown></li>)}</ul>
              </Section>
            )}

            {t && t.disconfirming.length > 0 && (
              <Section title="Disconfirming signals">
                <ul className="list-disc pl-5 space-y-1">{t.disconfirming.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </Section>
            )}

            {t && t.log.length > 0 && (
              <Section title="Thesis log">
                <ul className="space-y-1.5">
                  {[...t.log].reverse().map((l, i) => <li key={i} className="flex gap-2"><span className="w-14 shrink-0 text-xs text-zinc-500 pt-0.5">{l.date ? fmtDay(l.date) : ''}</span><span>{l.text}</span></li>)}
                </ul>
              </Section>
            )}

            <p className="text-[11px] text-zinc-400 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Edit this thesis in ThesisTracker/theses/{holding.ticker}.md — the app shows changes on its next refresh.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
