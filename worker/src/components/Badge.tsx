import type { FC } from 'hono/jsx';

export const Badge: FC<{ status: string | null }> = ({ status }) => {
  if (!status) return <span class="never">—</span>;
  if (status === 'PASS') return <span class="badge pass">INDEXED</span>;
  if (status === 'FAIL') return <span class="badge fail">NOT INDEXED</span>;
  if (status === 'NEUTRAL') return <span class="badge neutral">NEUTRAL</span>;
  return <span class="badge unknown">{status}</span>;
};
