// Owner only (Settings → Account): who may use the app. Everyone else who signs in
// sees an "Invite only" screen. Backed by /api/invites.

import React, { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { authedFetch } from '../backend';

interface Invite { email: string; addedAt: string }

export function InviteList() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => authedFetch('GET', '/api/invites').then(setInvites).catch(err => setError(err instanceof Error ? err.message : String(err)));
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await authedFetch('POST', '/api/invites', { email });
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (address: string) => {
    setError(null);
    try {
      await authedFetch('DELETE', `/api/invites/${encodeURIComponent(address)}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Who can use this app</h4>
      <p className="text-xs text-zinc-500">Only you and the Google addresses below can get in. Anyone else who signs in sees an "Invite only" message. Send them the link after adding them.</p>
      <form onSubmit={add} className="flex gap-2">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="friend@gmail.com" aria-label="Email to invite"
          className="flex-1 min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm" />
        <button type="submit" disabled={busy || !email.trim()} className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 dark:bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Invite
        </button>
      </form>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {invites === null && !error && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
      {invites && invites.length === 0 && <p className="text-xs text-zinc-400">Nobody invited yet.</p>}
      {invites && invites.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
          {invites.map(i => (
            <li key={i.email} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="truncate">{i.email}</span>
              <button onClick={() => remove(i.email)} className="p-1 text-zinc-400 hover:text-rose-600 rounded" aria-label={`Remove ${i.email}`} title="Remove access"><X className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
