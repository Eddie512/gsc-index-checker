import type { FC, PropsWithChildren } from 'hono/jsx';
import { html, raw } from 'hono/html';
import type { Property } from '../db';
import { escapeHtml } from '../lib/utils';
import { CSS, JS } from './styles';

interface LayoutProps {
  page: string;
  properties: Property[];
  currentProperty: Property | null;
}

const ChevronDown: FC = () => (
  <svg width="10" height="6" viewBox="0 0 10 6">
    <path d="M0 0l5 6 5-6z" fill="currentColor" />
  </svg>
);

const PropertySelector: FC<{ properties: Property[]; currentProperty: Property | null }> = ({
  properties,
  currentProperty,
}) => {
  return (
    <div class="dd prop-sw" data-name="property">
      <div class="dd-trigger">
        {currentProperty?.name || 'Select property'}
        <ChevronDown />
      </div>
      <div class="dd-panel">
        {properties.map((p) => (
          <div class={`dd-item${p.id === currentProperty?.id ? ' dd-active' : ''}`}>
            <a href={`/?property=${encodeURIComponent(p.id)}`}>{p.name}</a>
          </div>
        ))}
        <div class="dd-item" style="border-top:1px solid #333">
          <a href="/properties" style="color:var(--green)">+ Add Property</a>
        </div>
      </div>
    </div>
  );
};

function qs(currentProperty: Property | null): string {
  return currentProperty ? `?property=${encodeURIComponent(currentProperty.id)}` : '';
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  page,
  properties,
  currentProperty,
  children,
}) => {
  const q = qs(currentProperty);
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1.0" />
        <title>GSC Index Checker</title>
        {html`<style>${raw(CSS)}</style>`}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div class="c">
          <header>
            <div class="hdr-left">
              <h1>
                <span>GSC</span> Index Checker<span class="tz">Pacific Time</span>
              </h1>
              <PropertySelector properties={properties} currentProperty={currentProperty} />
              <a href="/properties" class={`nav-settings${page === 'properties' ? ' on' : ''}`} title="Manage Properties">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="10" cy="10" r="3" />
                  <path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.5 3.5l1.4 1.4M15.1 15.1l1.4 1.4M3.5 16.5l1.4-1.4M15.1 4.9l1.4-1.4" />
                </svg>
              </a>
            </div>
            <div class="nav">
              <a href={`/${q}`} class={page === 'dashboard' ? 'on' : undefined}>
                Dashboard
              </a>
              <a href={`/journeys${q}`} class={page === 'journeys' ? 'on' : undefined}>
                Journeys
              </a>
              <a href={`/submitted${q}`} class={page === 'submitted' ? 'on' : undefined}>
                Submitted
              </a>
              <a href={`/runs${q}`} class={page === 'runs' ? 'on' : undefined}>
                Run History
              </a>
              <a href={`/export${q}`}>Export CSV</a>
            </div>
          </header>
          {children}
        </div>
        {html`<script>${raw(JS)}</script>`}
      </body>
    </html>
  );
};
