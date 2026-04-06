/**
 * Tests for JSX components — HTML rendering, timezone formatting, escaping.
 */

import { describe, it, expect } from 'vitest';
import type { DashboardStats, UrlRow, RunRow } from '../src/db';
import { DashboardPage } from '../src/components/DashboardPage';
import { RunsPage } from '../src/components/RunsPage';

/** Render a Hono JSX element to string. */
function render(element: any): string {
  return element.toString();
}

const emptyStats: DashboardStats = {
  total: 0,
  indexed: 0,
  notIndexed: 0,
  unchecked: 0,
  checked: 0,
};

const sampleStats: DashboardStats = {
  total: 100,
  indexed: 60,
  notIndexed: 25,
  unchecked: 15,
  checked: 85,
};

const sampleUrls: UrlRow[] = [
  {
    url: 'https://www.test.com/holiday/christmas',
    index_status: 'PASS',
    coverage_state: 'Submitted and indexed',
    last_crawl_time: '2026-02-26T18:30:00Z',
    last_checked_at: '2026-02-26T20:00:00Z',
    first_seen_at: '2026-02-20T10:00:00Z',
    label: 'holiday',
    content_updated_at: '2026-02-15',
    indexing_submitted_at: null,
    removed_from_sitemap_at: null,
    traffic: 6,
  },
  {
    url: 'https://www.test.com/holiday/easter',
    index_status: 'NEUTRAL',
    coverage_state: null,
    last_crawl_time: null,
    last_checked_at: '2026-02-26T19:00:00Z',
    first_seen_at: '2026-02-20T10:00:00Z',
    label: null,
    content_updated_at: null,
    indexing_submitted_at: null,
    removed_from_sitemap_at: null,
    traffic: 0,
  },
];

const defaultProps = {
  properties: [],
  currentProperty: null,
  hasData: true,
};

describe('DashboardPage', () => {
  it('renders valid HTML', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={2}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).toContain('</html>');
  });

  it('displays Pacific Time indicator', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={2}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).toContain('Pacific Time');
  });

  it('displays stats correctly', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={2}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).toContain('100');
    expect(html).toContain('60');
    expect(html).toContain('25');
    expect(html).toContain('15');
    expect(html).toContain('85');
  });

  it('renders INDEXED badge for PASS status', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={2}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).toContain('INDEXED');
    expect(html).toContain('badge pass');
  });

  it('displays labels and "+ label" placeholder', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={2}
        q="" status="" labelFilter="" labels={['holiday']}
        sort="last_checked_at" dir="desc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).toContain('holiday');
    expect(html).toContain('+ label');
  });

  it('renders bulk label form with total count', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={1}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={50} offset={0}
        {...defaultProps}
      />
    );
    expect(html).toContain('Bulk Label');
    expect(html).toContain('Apply to All 50');
  });

  it('shows pagination when needed', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={3}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).toContain('Next');
  });

  it('does not show pagination for single page', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={1}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).not.toContain('Next');
  });

  it('escapes HTML in labels to prevent XSS', () => {
    const xssUrl: UrlRow = {
      url: 'https://example.com/test',
      index_status: null,
      coverage_state: null,
      last_crawl_time: null,
      last_checked_at: null,
      first_seen_at: null,
      label: '<img onerror=alert(1)>',
      content_updated_at: null,
      indexing_submitted_at: null,
      removed_from_sitemap_at: null,
      traffic: 0,
    };
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={[xssUrl]} totalPages={1}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).not.toContain('<img onerror');
  });

  it('shows empty state when total is 0', () => {
    const html = render(
      <DashboardPage
        stats={emptyStats} urls={[]} totalPages={0}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={0} offset={0}
        {...defaultProps} hasData={false}
      />
    );
    expect(html).toContain('No data yet');
    expect(html).not.toContain('Bulk Label');
  });

  it('includes JS functions', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={2}
        q="" status="" labelFilter="" labels={[]}
        sort="last_checked_at" dir="desc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).toContain('editLabel');
    expect(html).toContain('saveLabel');
    expect(html).toContain('bulkLabel');
  });

  it('preserves selected filter values', () => {
    const html = render(
      <DashboardPage
        stats={sampleStats} urls={sampleUrls} totalPages={2}
        q="test-search" status="PASS" labelFilter="holiday" labels={['holiday']}
        sort="url" dir="asc" page={1} total={100} offset={0}
        {...defaultProps}
      />
    );
    expect(html).toContain('test-search');
    expect(html).toContain('name="status" value="PASS"');
  });
});

describe('RunsPage', () => {
  const sampleRuns: RunRow[] = [
    {
      id: 1,
      run_type: 'inspect',
      started_at: '2026-02-26T10:00:00Z',
      finished_at: '2026-02-26T10:05:00Z',
      urls_checked: 42,
      urls_indexed: 30,
      urls_not_indexed: 10,
      urls_error: 2,
      details: null,
    },
  ];

  it('renders valid HTML', () => {
    const html = render(
      <RunsPage runs={sampleRuns} {...defaultProps} />
    );
    expect(html).toContain('Run History');
  });

  it('shows run stats', () => {
    const html = render(
      <RunsPage runs={sampleRuns} {...defaultProps} />
    );
    expect(html).toContain('42');
    expect(html).toContain('30');
    expect(html).toContain('10');
  });

  it('calculates duration', () => {
    const html = render(
      <RunsPage runs={sampleRuns} {...defaultProps} />
    );
    expect(html).toContain('5m 0s');
  });

  it('shows error badge when errors > 0', () => {
    const html = render(
      <RunsPage runs={sampleRuns} {...defaultProps} />
    );
    expect(html).toContain('badge unknown');
  });

  it('shows empty state when no runs', () => {
    const html = render(
      <RunsPage runs={[]} {...defaultProps} />
    );
    expect(html).toContain('No runs yet');
  });
});
