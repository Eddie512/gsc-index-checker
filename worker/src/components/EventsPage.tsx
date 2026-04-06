import type { FC } from 'hono/jsx';
import type { Property } from '../db';
import { formatDate } from '../lib/utils';
import { Layout } from './Layout';

interface HttpEvent {
  url: string;
  status_code: number;
  referrer: string | null;
  country: string | null;
  device: string | null;
  ts: string | null;
}

interface Props {
  events: HttpEvent[];
  counts: { status_code: number; count: number }[];
  properties: Property[];
  currentProperty: Property | null;
  statusFilter: number | null;
}

export const EventsPage: FC<Props> = ({
  events,
  counts,
  properties,
  currentProperty,
  statusFilter,
}) => {
  const pp = currentProperty ? `property=${encodeURIComponent(currentProperty.id)}` : '';
  const qs = pp ? `&${pp}` : '';

  return (
    <Layout page="events" properties={properties} currentProperty={currentProperty}>
      <h2 style="font-size:14px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;margin-bottom:16px">
        HTTP Events
      </h2>

      {counts.length > 0 && (
        <div style="display:flex;gap:0;margin-bottom:24px;border:1px solid var(--border)">
          <a
            href={`/events?${pp}`}
            class={`sc${!statusFilter ? ' g' : ''}`}
            style="text-decoration:none;cursor:pointer"
          >
            <div class="l">All</div>
            <div class="v">{counts.reduce((s, c) => s + c.count, 0)}</div>
          </a>
          {counts.map((c) => (
            <a
              href={`/events?status=${c.status_code}${qs}`}
              class={`sc${statusFilter === c.status_code ? ' r' : ''}`}
              style="text-decoration:none;cursor:pointer"
            >
              <div class="l">{c.status_code}</div>
              <div class="v">{c.count}</div>
            </a>
          ))}
        </div>
      )}

      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th>URL</th>
              <th>Referrer</th>
              <th>Country</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {events.length > 0 ? (
              events.map((e) => (
                <tr>
                  <td class="dc">{formatDate(e.ts)}</td>
                  <td>
                    <span class="badge fail">{e.status_code}</span>
                  </td>
                  <td class="uc">{e.url}</td>
                  <td class="dc">{e.referrer || '—'}</td>
                  <td class="dc">{e.country || '—'}</td>
                  <td class="dc">{e.device || '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colspan={6} style="text-align:center;padding:40px;color:var(--text-muted)">
                  No events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
};
