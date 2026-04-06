import type { FC } from 'hono/jsx';
import { html, raw } from 'hono/html';
import type { Property } from '../db';
import { Layout } from './Layout';

interface Props {
  properties: Property[];
  currentProperty: Property | null;
  editProperty: Property | null;
}

const PropertyListItem: FC<{ property: Property; isEditing: boolean }> = ({ property: p, isEditing }) => (
  <div class={`prop-item${isEditing ? ' editing' : ''}`}>
    <div class="prop-item-header">
      <span class="prop-item-name">{p.name}</span>
      <div class="prop-item-actions">
        <a href={`/properties?edit=${encodeURIComponent(p.id)}`} title="Edit">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
        </a>
        <button onclick={`deleteProperty('${p.id}','${p.name}')`} title="Delete">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"/></svg>
        </button>
      </div>
    </div>
    <div class="prop-item-details">
      <span>{p.site_url}</span>
      <span class="dot">·</span>
      <span>{p.domain}</span>
    </div>
  </div>
);

const SetupInstructions: FC = () => (
  <div class="setup-hint">
    <h4>Before adding a property</h4>
    <p>Grant your service account access to this property in Google Search Console:</p>
    <ol>
      <li>Go to <a href="https://search.google.com/search-console" target="_blank" rel="noopener">Google Search Console</a></li>
      <li>Select your property</li>
      <li>Navigate to <strong>Settings &rarr; Users and permissions</strong></li>
      <li>Click <strong>Add user</strong> and enter your service account email<br /><span style="color:var(--text-muted);font-size:11px">(the GSC_CLIENT_EMAIL value from your wrangler secrets)</span></li>
      <li>Set permission to <strong>Owner</strong> and save</li>
    </ol>
    <p style="color:var(--text-muted);font-size:11px;margin-top:8px">Without this, the sitemap will sync but all URL inspections will fail with errors.</p>
    <p style="color:var(--text-muted);font-size:11px">
      Don't have a service account yet? See the <a href="https://github.com/anthropics/gsc-index-checker#1-google-cloud-project" target="_blank" rel="noopener">Google Cloud setup guide</a> in the README.
    </p>
  </div>
);

const PropertyForm: FC<{ editProperty: Property | null }> = ({ editProperty }) => {
  const isEdit = !!editProperty;
  return (
    <div class="prop-form-panel">
      <h3 class="prop-form-title">
        {isEdit ? 'Edit Property' : 'New Property'}
      </h3>
      {!isEdit && <SetupInstructions />}
      <form id="prop-form" onsubmit="submitProperty(event)">
        <input type="hidden" name="id" value={editProperty?.id || ''} />
        <div class="form-row">
          <label>Domain</label>
          <input type="text" name="domain" placeholder="example.com" value={editProperty?.domain || ''} required
            oninput={isEdit ? undefined : 'derivePropFields(this.value)'} />
        </div>
        <div class="form-row">
          <label>Display Name</label>
          <input type="text" name="name" placeholder="My Website" value={editProperty?.name || ''} required />
        </div>
        <div class="form-row">
          <label>GSC Site URL</label>
          <input type="text" name="site_url" placeholder="sc-domain:example.com" value={editProperty?.site_url || ''} required />
        </div>
        <div class="form-row">
          <label>Sitemap URL</label>
          <input type="text" name="sitemap_url" placeholder="https://example.com/sitemap.xml" value={editProperty?.sitemap_url || ''} />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary">
            {isEdit ? 'Update' : 'Add'} Property
          </button>
          {isEdit && (
            <a href="/properties" class="btn-cancel">Cancel</a>
          )}
        </div>
      </form>
    </div>
  );
};

const PROPERTIES_JS = `
function derivePropFields(domain) {
  var form = document.getElementById('prop-form');
  var d = domain.trim().replace(/^https?:\\/\\//, '').replace(/\\/+$/, '').toLowerCase();
  // strip www. for slug/name derivation
  var bare = d.replace(/^www\\./, '');
  // slug: take part before TLD, e.g. "example.com" -> "example", "my-site.co.uk" -> "my-site"
  var slug = bare.split('.')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  form.id.value = slug;
  // auto-fill name (capitalize first letter of each word)
  if (!form.name._userEdited) {
    var name = bare.split('.')[0].replace(/[-_]+/g, ' ').replace(/\\b\\w/g, function(c){return c.toUpperCase()});
    form.name.value = name;
  }
  // auto-fill GSC site URL
  if (!form.site_url._userEdited) {
    form.site_url.value = d ? 'sc-domain:' + bare : '';
  }
  // auto-fill sitemap URL
  if (!form.sitemap_url._userEdited) {
    form.sitemap_url.value = d ? 'https://' + (d.startsWith('www.') ? d : 'www.' + d) + '/sitemap.xml' : '';
  }
}
// track manual edits so auto-fill doesn't overwrite
document.addEventListener('DOMContentLoaded', function() {
  var form = document.getElementById('prop-form');
  ['name','site_url','sitemap_url'].forEach(function(f) {
    form[f].addEventListener('input', function() { this._userEdited = true; });
  });
});
function submitProperty(e) {
  e.preventDefault();
  var form = e.target;
  var domain = form.domain.value.trim().replace(/^https?:\\/\\//, '').replace(/\\/+$/, '').toLowerCase();
  var isEdit = !!form.id.value && form.id.value === form.id.defaultValue && form.id.defaultValue !== '';
  // for new properties, derive ID from domain if not set
  if (!isEdit && !form.id.value) {
    var bare = domain.replace(/^www\\./, '');
    form.id.value = bare.split('.')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  var data = {
    id: form.id.value.trim(),
    name: form.name.value.trim(),
    site_url: form.site_url.value.trim(),
    domain: domain,
    sitemap_url: form.sitemap_url.value.trim() || null
  };
  var url = isEdit ? '/api/properties/' + encodeURIComponent(data.id) : '/api/properties';
  var method = isEdit ? 'PUT' : 'POST';
  fetch(url, {
    method: method,
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  }).then(function(r) {
    if (!r.ok) return r.json().then(function(d) { alert(d.error || 'Error'); throw new Error(); });
    return r.json();
  }).then(function() {
    window.location.href = isEdit ? '/properties' : '/?property=' + encodeURIComponent(data.id);
  })
    .catch(function() {});
}
function deleteProperty(id, name) {
  if (!confirm('Delete property "' + name + '"? This removes all URLs, runs, and analytics for this property.')) return;
  fetch('/api/properties/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function() { window.location.reload(); });
}
`;

export const PropertiesPage: FC<Props> = ({ properties, currentProperty, editProperty }) => (
  <Layout page="properties" properties={properties} currentProperty={currentProperty}>
    <div class="props-layout">
      <div class="props-sidebar">
        <h2 class="props-sidebar-title">Properties</h2>
        {properties.length > 0 ? (
          properties.map((p) => (
            <PropertyListItem property={p} isEditing={editProperty?.id === p.id} />
          ))
        ) : (
          <div class="props-empty">
            <p>No properties yet</p>
          </div>
        )}
      </div>
      <div class="props-main">
        <PropertyForm editProperty={editProperty} />
      </div>
    </div>
    {html`<script>${raw(PROPERTIES_JS)}</script>`}
  </Layout>
);
