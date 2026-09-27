'use client';

import { useState, type JSX } from 'react';
import { NewListing } from './pages/NewListing';
import { Preview } from './pages/Preview';
import { History } from './pages/History';
import { Articles, ArticleView } from './pages/Articles';
import { SettingsPage } from './pages/SettingsPage';
import { Invoices } from './pages/Invoices';
import { ArrowLeftIcon, BoxIcon, GearIcon, HistoryIcon, ReceiptIcon } from './components/icons';

import type { View } from './view';

export type { View };

export function App({ initial }: { initial?: View }) {
  const [view, setView] = useState<View>(initial ?? { page: 'search' });
  const home = () => setView({ page: 'search' });

  /** Verlauf und Einstellungen sind Abstecher — dasselbe Icon führt wieder zurück. */
  const toggle = (page: 'history' | 'articles' | 'settings' | 'invoices') =>
    setView((v) => (v.page === page ? { page: 'search' } : { page }));

  const icon = (page: 'history' | 'articles' | 'settings' | 'invoices', label: string, glyph: JSX.Element) => (
    <button
      className={'icon-btn' + (view.page === page ? ' active' : '')}
      onClick={() => toggle(page)}
      title={label}
      aria-label={label}
    >
      {glyph}
    </button>
  );

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={home}>LuGru <span>eBay-Tool</span></button>
        <nav className="icon-nav">
          {icon('articles', 'Artikel', <BoxIcon />)}
          {icon('history', 'Verlauf', <HistoryIcon />)}
          {icon('invoices', 'Rechnungen', <ReceiptIcon />)}
          {icon('settings', 'Einstellungen', <GearIcon />)}
        </nav>
      </header>

      <main className="content">
        {(view.page === 'history' || view.page === 'articles' || view.page === 'settings' || view.page === 'invoices') && (
          <button className="back" onClick={home}><ArrowLeftIcon size={16} /> Zur Suche</button>
        )}
        {view.page === 'search' && <NewListing onCreated={(id) => setView({ page: 'preview', id })} />}
        {view.page === 'preview' && <Preview id={view.id} onBack={home} />}
        {view.page === 'history' && <History onOpen={(id) => setView({ page: 'preview', id })} />}
        {view.page === 'articles' && <Articles onOpen={(key) => setView({ page: 'article', key })} />}
        {view.page === 'article' && (
          <ArticleView
            articleKey={view.key}
            onBack={() => setView({ page: 'articles' })}
            onOpenAttempt={(id) => setView({ page: 'preview', id })}
          />
        )}
        {view.page === 'settings' && <SettingsPage initialTab={view.tab} />}
        {view.page === 'invoices' && <Invoices onSettings={() => setView({ page: 'settings', tab: 'invoices' })} />}
      </main>
    </div>
  );
}
