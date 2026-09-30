// Public privacy policy and data-deletion pages: what the app stores and how any
// user can delete their account.

import type { Express } from 'express';

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Portfolio Tracker</title>
<style>
  :root { color-scheme: light dark; --fg: #18181b; --muted: #52525b; --bg: #fafafa; }
  @media (prefers-color-scheme: dark) { :root { --fg: #f4f4f5; --muted: #a1a1aa; --bg: #09090b; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; } h2 { font-size: 1.1rem; margin: 2rem 0 .5rem; }
  p, li { color: var(--muted); } a { color: #4f46e5; }
</style></head><body><main>${body}</main></body></html>`;

export function registerLegalPages(app: Express) {
  const contact = (process.env.CONTACT_EMAIL || process.env.BOT_OWNER_EMAIL || '').trim();
  const contactLine = contact ? `<a href="mailto:${contact}">${contact}</a>` : 'the app owner';

  app.get('/privacy', (_req, res) => {
    res.type('html').send(page('Privacy policy', `
      <h1>Privacy policy</h1>
      <p>Last updated 30 September 2026.</p>
      <p>Portfolio Tracker is a personal investment tracker. This page explains what it stores and why. Sign-in is handled by Neon Auth using Google.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>From Google sign-in:</b> your name, email address and profile picture, and an identifier for your account with that provider. We never see your password.</li>
        <li><b>What you enter:</b> holdings, transactions, price alerts, saved notes and settings, including any AI provider API keys you choose to add.</li>
      </ul>
      <h2>How it's used</h2>
      <p>Only to run the app for you: to show your portfolio, fetch market prices and company data, and send the price alerts you set up to your own email address. Your data is not sold, shared with advertisers or used to train models.</p>
      <h2>Where it's stored</h2>
      <p>In a Postgres database hosted by Neon. Market data is fetched from Yahoo Finance, Finnhub and the SEC; your portfolio is not sent to them. If you use AI analysis, the prompt (which can include your holdings) goes to the AI provider whose key you supplied.</p>
      <h2>Your choices</h2>
      <p>You can delete your account and all of its data at any time: see <a href="/data-deletion">data deletion</a>.</p>
      <h2>Contact</h2>
      <p>Questions: ${contactLine}.</p>`));
  });

  app.get('/data-deletion', (_req, res) => {
    res.type('html').send(page('Delete your data', `
      <h1>Delete your data</h1>
      <p>You can delete your Portfolio Tracker account, and everything stored with it, yourself:</p>
      <ol>
        <li>Sign in to Portfolio Tracker with the Google account you used.</li>
        <li>Open <b>Settings</b> (the gear icon), then <b>Account</b>.</li>
        <li>Choose <b>Delete my account</b> and confirm.</li>
      </ol>
      <p>This immediately and permanently deletes your holdings, transactions, alerts, saved notes, settings and your sign-in record. It can't be undone.</p>
      <p>You can also remove the app's access in your Google account under <b>Third-party apps with account access</b>.</p>
      <p>If you can't sign in, email ${contactLine} from the address on your account and we'll delete it for you.</p>`));
  });
}
