import type { FC } from 'hono/jsx';
import type { UrlRow, Property } from '../db';
import { formatDate } from '../lib/utils';
import { Layout } from './Layout';
import { Badge } from './Badge';

interface Props {
  urls: UrlRow[];
  properties: Property[];
  currentProperty: Property | null;
}

export const SubmittedPage: FC<Props> = ({ urls, properties, currentProperty }) => (
  <Layout page="submitted" properties={properties} currentProperty={currentProperty}>
    <h2 style="font-size:14px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;margin-bottom:16px">
      Recently Submitted
    </h2>
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th>Index Status</th>
            <th>Submitted At</th>
            <th>Last Checked</th>
          </tr>
        </thead>
        <tbody>
          {urls.length > 0 ? (
            urls.map((r) => (
              <tr>
                <td class="uc">
                  <a href={r.url} target="_blank">
                    {r.url}
                  </a>
                </td>
                <td>
                  <Badge status={r.index_status} coverage={r.coverage_state} />
                </td>
                <td class="dc">{formatDate(r.indexing_submitted_at ?? null)}</td>
                <td class="dc">{formatDate(r.last_checked_at)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colspan={4} style="text-align:center;padding:40px;color:var(--text-muted)">
                No submissions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </Layout>
);
