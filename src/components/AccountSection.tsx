// Settings → Account: who you're signed in as, and deleting the account with all its
// data (DELETE /api/me), then signing out. The owner's account can't be deleted here.

import React, { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { auth, authedFetch, signOut } from '../backend';
import { InviteList } from './InviteList';

interface Me { email: string | null; name: string | null; providers: string[]; isOwner: boolean }

const PROVIDER_NAMES: Record<string, string> = { google: 'Google' };

export function AccountSection() {
  const [me, setMe] = useState<Me | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { authedFetch('GET', '/api/me').then(setMe).catch(() => setMe(null)); }, []);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await authedFetch('DELETE', '/api/me', { confirm: 'DELETE' });
      await signOut(auth).catch(() => {});
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-6">
      <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Account</h3>
      {me && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as <b>{me.email ?? me.name}</b>
          {me.providers.length > 0 && <> with {me.providers.map(p => PROVIDER_NAMES[p] ?? p).join(' and ')}</>}.
        </p>
      )}
      {me && !me.isOwner && (
        !confirming ? (
          <button onClick={() => setConfirming(true)} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950">
            <Trash2 className="w-4 h-4" /> Delete my account
          </button>
        ) : (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/30 p-4 space-y-3">
            <p className="text-sm text-rose-700 dark:text-rose-300">
              This permanently deletes your holdings, transactions, alerts, saved notes and settings, and signs you out. It can't be undone.
            </p>
            <label className="block text-xs text-zinc-600 dark:text-zinc-400">
              Type <b>DELETE</b> to confirm
              <input value={typed} onChange={e => setTyped(e.target.value)} autoFocus
                className="mt-1 block w-40 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm" />
            </label>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={remove} disabled={typed !== 'DELETE' || deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />} Delete everything
              </button>
              <button onClick={() => { setConfirming(false); setTyped(''); }} className="rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button>
            </div>
          </div>
        )
      )}
      {me?.isOwner && <p className="text-xs text-zinc-400">This is the app owner's account, so it can't be deleted here.</p>}
      {me?.isOwner && <InviteList />}
      <p className="text-xs text-zinc-400"><a href="/privacy" className="underline">Privacy policy</a> · <a href="/data-deletion" className="underline">Data deletion</a></p>
    </section>
  );
}
