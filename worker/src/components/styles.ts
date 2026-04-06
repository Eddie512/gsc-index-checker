/** Global CSS — kept as a string constant injected into <style>. */
export const CSS = `
:root{--bg:#000;--surface:#0a0a0a;--surface-hover:#111;--border:#1a1a1a;--text:#fff;--text-muted:#555;--green:#00ff66;--green-bg:rgba(0,255,102,.08);--red:#ff3333;--red-bg:rgba(255,51,51,.08);--yellow:#ffcc00;--yellow-bg:rgba(255,204,0,.08)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;-webkit-font-smoothing:antialiased}
.c{max-width:1440px;margin:0 auto;padding:32px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px;padding-bottom:24px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:16px}
h1{font-size:14px;font-weight:500;letter-spacing:.08em;text-transform:uppercase}
h1 span{color:var(--text-muted)}
.tz{font-size:10px;color:var(--text-muted);letter-spacing:.04em;margin-left:8px;text-transform:none;font-weight:400}
.nav{display:flex;gap:0}
.nav a{padding:8px 20px;text-decoration:none;font-size:12px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--border);color:var(--text-muted);transition:all .1s;margin-left:-1px}
.nav a:first-child{margin-left:0}
.nav a:hover{color:var(--text);background:var(--surface-hover)}
.nav a.on{background:#fff;border-color:#fff;color:#000}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:0;margin-bottom:40px;border:1px solid var(--border)}
.sc{padding:24px;border-right:1px solid var(--border);display:block}
a.sc{cursor:pointer;transition:background .1s}a.sc:hover{background:var(--surface-hover)}
.sc:last-child{border-right:none}
.sc .l{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:8px}
.sc .v{font-size:32px;font-weight:300;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.sc .s{font-size:11px;color:var(--text-muted);margin-top:4px;font-variant-numeric:tabular-nums}
.sc.g .v{color:var(--green)}.sc.r .v{color:var(--red)}.sc.y .v{color:var(--yellow)}
.pb{height:2px;background:var(--border);overflow:hidden;margin-top:12px}
.pb div{height:100%;background:var(--green);transition:width .3s}
.fi{display:flex;gap:0;margin-bottom:0;align-items:stretch;border:1px solid var(--border);border-bottom:none;flex-wrap:wrap}
.fi input{background:var(--surface);border:none;border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:12px 16px;color:var(--text);font-size:12px;font-family:inherit;outline:none;letter-spacing:.02em;cursor:text;flex:1;min-width:200px}
.fi input::placeholder{color:var(--text-muted)}
.fi button{background:#fff;border:none;border-right:1px solid var(--border);border-bottom:1px solid var(--border);color:#000;padding:12px 24px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;font-family:inherit;transition:opacity .1s;white-space:nowrap}
.fi button:hover{opacity:.8}
.fi .rc{padding:12px 16px;font-size:11px;color:var(--text-muted);letter-spacing:.04em;white-space:nowrap;border-left:0;display:flex;align-items:center}
.fi .clear{padding:12px 16px;font-size:11px;color:var(--red);background:var(--red-bg);letter-spacing:.06em;text-transform:uppercase;font-weight:600;white-space:nowrap;border-right:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;align-items:center;text-decoration:none;transition:background .1s}
.fi .clear:hover{background:rgba(255,51,51,.18)}
.dd{position:relative;border-right:1px solid var(--border);border-bottom:1px solid var(--border);min-width:130px;user-select:none}
.dd-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px;font-size:12px;color:var(--text-muted);letter-spacing:.02em;cursor:pointer;background:var(--surface);transition:all .1s;white-space:nowrap}
.dd-trigger:hover{background:var(--surface-hover);color:var(--text)}
.dd-trigger svg{flex-shrink:0;opacity:.5;transition:transform .15s}
.dd.open .dd-trigger{background:var(--surface-hover);color:var(--text)}
.dd.open .dd-trigger svg{transform:rotate(180deg)}
.dd-panel{display:none;position:absolute;top:100%;left:-1px;right:-1px;background:#0a0a0a;border:1px solid #222;border-top:none;z-index:100;max-height:280px;overflow-y:auto}
.dd.open .dd-panel{display:block}
.dd-item{padding:10px 16px;font-size:12px;color:var(--text-muted);cursor:pointer;transition:all .08s;letter-spacing:.02em;white-space:nowrap;border-bottom:1px solid var(--border)}
.dd-item:last-child{border-bottom:none}
.dd-item:hover{background:#111;color:var(--text)}
.dd-item.dd-active{color:var(--text);background:rgba(255,255,255,.04)}
.dd-item.dd-active::before{content:'';display:inline-block;width:4px;height:4px;background:var(--text);margin-right:8px;vertical-align:middle}
.prop-sw .dd-item.dd-active::before{display:none}
.prop-sw .dd-item.dd-active a::before{content:'';display:inline-block;width:4px;height:4px;background:var(--green);margin-right:8px;vertical-align:middle}
.dd-panel::-webkit-scrollbar{width:3px}
.dd-panel::-webkit-scrollbar-track{background:transparent}
.dd-panel::-webkit-scrollbar-thumb{background:#333}
.tw{border:1px solid var(--border);overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{text-align:left;padding:12px 16px;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);border-bottom:1px solid var(--border);background:var(--surface);white-space:nowrap}
.tip{position:relative;cursor:help;text-decoration:underline dotted var(--text-muted);text-underline-offset:3px}
.tip::after{content:attr(data-tip);position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#222;color:#ccc;font-size:11px;font-weight:400;letter-spacing:normal;text-transform:none;line-height:1.5;padding:8px 12px;border:1px solid #333;white-space:normal;width:220px;pointer-events:none;opacity:0;transition:opacity .15s;z-index:200}
.has-tip{position:relative;overflow:visible}
.tip:hover::after{opacity:1}
tbody tr{border-bottom:1px solid var(--border);transition:background .05s}
tbody tr:last-child{border-bottom:none}
tbody tr:hover{background:var(--surface-hover)}
td{padding:10px 16px;white-space:nowrap;font-variant-numeric:tabular-nums}
.uc{white-space:normal;word-break:break-all;max-width:440px;font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;letter-spacing:-.01em}
.uc a{color:var(--text);text-decoration:none}
.uc a:hover{text-decoration:underline}
.badge{display:inline-block;padding:3px 8px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.badge.pass{background:var(--green-bg);color:var(--green)}
.badge.fail,.badge.bad{background:var(--red-bg);color:var(--red)}
.badge.unknown,.badge.warn{background:var(--yellow-bg);color:var(--yellow)}
.badge.neutral{background:rgba(255,255,255,.05);color:var(--text-muted)}
.badge.excluded{background:rgba(255,255,255,.05);color:#888}
.dc{color:var(--text-muted);font-size:11px}
.never{color:#333}
.lbl{display:inline-block;padding:2px 8px;font-size:10px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--border);color:var(--text-muted);cursor:pointer;transition:all .1s}
.lbl:hover{border-color:var(--text);color:var(--text)}
.lbl-set{border-color:#333;color:var(--text);background:rgba(255,255,255,.05)}
.lbl-edit{background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:11px;font-family:inherit;padding:4px 8px;width:100px;outline:none}
.lbl-edit:focus{border-color:#fff}
.s-list{display:flex;flex-direction:column;gap:2px}
.s-card{border:1px solid var(--border);background:var(--surface);padding:14px 18px}
.s-card:hover{border-color:#444}
.s-meta{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);flex-wrap:wrap}
.s-time{color:var(--text);font-weight:500}
.s-sep{opacity:.3}
.s-flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px}
.s-chip{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:4px;padding:6px 10px;min-width:0}
.s-chip-path{font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
.s-chip-stats{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--text-muted);margin-top:3px;font-variant-numeric:tabular-nums}
.s-chip-scroll{display:flex;align-items:center;gap:4px}
.s-scroll-bar{width:36px;height:3px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden;display:inline-block}
.s-scroll-fill{display:block;height:100%;background:var(--green);border-radius:2px}
.s-arrow{color:var(--text-muted);opacity:.3;font-size:11px;flex-shrink:0}
.s-arrow-sm{color:#444;margin:0 3px;font-size:10px}
.s-past-toggle{display:flex;align-items:center;gap:6px;margin-top:10px;padding-top:8px;border-top:1px dashed var(--border);cursor:pointer}
.s-past-label{font-size:10px;color:var(--text-muted);letter-spacing:.04em}
.s-past{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.s-past-row{padding:8px 10px;border:1px solid var(--border);border-radius:3px;background:rgba(255,255,255,.02)}
.s-past-meta{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text-muted)}
.s-past-trail{display:flex;flex-wrap:wrap;align-items:center;gap:2px 4px;font-size:10px;color:var(--text-muted);font-family:'SF Mono','JetBrains Mono',monospace;margin-top:4px}
.btn-expand{display:inline-block;width:14px;text-align:center}
.traffic-link{color:var(--green);text-decoration:none;font-variant-numeric:tabular-nums}
.traffic-link:hover{text-decoration:underline}
.path-filter-bar{display:flex;align-items:center;gap:8px;padding:10px 16px;margin-bottom:16px;border:1px solid var(--border);background:var(--surface);font-size:12px;color:var(--text-muted)}
.path-filter-path{font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;color:var(--text);background:rgba(255,255,255,.06);padding:2px 8px;border-radius:3px}
.path-filter-clear{color:var(--red);text-decoration:none;margin-left:auto;font-size:11px}
.path-filter-clear:hover{text-decoration:underline}
.view-tabs{display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--border)}
.view-tab{padding:10px 20px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
.view-tab:hover{color:var(--text)}
.view-tab.active{color:var(--text);border-bottom-color:var(--green);font-weight:600}
.view-tab-count{font-weight:400;opacity:.6;margin-left:4px;font-variant-numeric:tabular-nums}
.journeys-layout{display:grid;grid-template-columns:1fr 300px;gap:24px;align-items:start}
.journeys-main{min-width:0;overflow-x:auto}
.journeys-sidebar{position:sticky;top:16px;display:flex;flex-direction:column;gap:24px}
.sidebar-section{border:1px solid var(--border);background:var(--surface)}
.sidebar-heading{font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;padding:12px 16px;border-bottom:1px solid var(--border);color:var(--text-muted);margin:0}
.top-pages-list{max-height:520px;overflow-y:auto}
.top-page-item{display:flex;align-items:baseline;gap:10px;padding:7px 16px;border-bottom:1px solid var(--border);font-size:12px}
.top-page-item:last-child{border-bottom:none}
.top-page-rank{color:var(--text-muted);font-size:10px;min-width:18px;text-align:right;font-variant-numeric:tabular-nums}
.top-page-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;color:var(--text)}
.top-page-views{color:var(--green);font-weight:600;font-size:11px;font-variant-numeric:tabular-nums}
.recent-events-list{max-height:300px;overflow-y:auto}
.recent-event-item{padding:8px 16px;border-bottom:1px solid var(--border);font-size:11px}
.recent-event-item:last-child{border-bottom:none}
.recent-event-url{font-family:'SF Mono','JetBrains Mono',monospace;color:var(--red);word-break:break-all}
.recent-event-meta{color:var(--text-muted);font-size:10px;margin-top:3px}
@media(max-width:1100px){.journeys-layout{grid-template-columns:1fr}.journeys-sidebar{position:static;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}}
.pg{display:flex;justify-content:center;align-items:center;gap:0;margin-top:24px;border:1px solid var(--border);width:fit-content;margin-left:auto;margin-right:auto}
.pg a,.pg span{padding:8px 16px;font-size:12px;text-decoration:none;border-right:1px solid var(--border);color:var(--text-muted);transition:all .1s;font-variant-numeric:tabular-nums}
.pg a:last-child,.pg span:last-child{border-right:none}
.pg a:hover{background:var(--surface-hover);color:var(--text)}
.pg span.cur{background:#fff;color:#000;font-weight:600}
.bulk{display:flex;gap:0;margin-top:16px;align-items:stretch;border:1px solid var(--border)}
.bulk label{padding:10px 16px;font-size:11px;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase;display:flex;align-items:center;border-right:1px solid var(--border);white-space:nowrap}
.bulk input{background:transparent;border:none;border-right:1px solid var(--border);padding:10px 16px;color:var(--text);font-size:12px;font-family:inherit;outline:none;flex:1;min-width:150px}
.bulk input::placeholder{color:var(--text-muted)}
.bulk button{background:#fff;border:none;color:#000;padding:10px 20px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;font-family:inherit;transition:opacity .1s;white-space:nowrap}
.bulk button:hover{opacity:.8}
.bulk .cnt{padding:10px 16px;font-size:11px;color:var(--text-muted);display:flex;align-items:center}
.empty{text-align:center;padding:120px 20px;color:var(--text-muted)}
.empty h2{font-size:14px;font-weight:500;margin-bottom:12px;color:var(--text);letter-spacing:.04em;text-transform:uppercase}
.empty-journeys{border:1px solid var(--border);padding:60px 40px;text-align:center;color:var(--text-muted)}
.empty-journeys h3{font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text);margin-bottom:12px}
.empty-journeys p{font-size:12px;line-height:1.7;max-width:520px;margin:0 auto 16px}
.empty-journeys pre{background:var(--surface);border:1px solid var(--border);padding:16px 20px;margin:16px auto;max-width:520px;text-align:left;overflow-x:auto}
.empty-journeys code{font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;color:var(--green)}
@media(max-width:900px){.stats{grid-template-columns:repeat(2,1fr)}.sc:nth-child(2n){border-right:none}.sc:nth-child(n+3){border-top:1px solid var(--border)}}
.hdr-left{display:flex;align-items:center;gap:16px}
.nav-settings{color:var(--text-muted);transition:color .15s;display:flex;align-items:center;padding:4px}
.nav-settings:hover,.nav-settings.on{color:var(--text)}
.prop-sw{position:relative;border:1px solid var(--border)}
.prop-sw .dd-trigger{padding:8px 14px;font-size:12px;font-weight:500;letter-spacing:.04em;color:var(--green)}
.prop-sw .dd-panel{min-width:200px}
.prop-sw .dd-panel a{display:block;text-decoration:none;color:inherit}
.prop-sw .dd-item.dd-active{color:var(--green)}
.setup-hint{border:1px solid var(--border);padding:16px 20px;margin-bottom:20px;font-size:12px;line-height:1.7;color:var(--text-muted)}
.setup-hint h4{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text);margin:0 0 8px}
.setup-hint ol{margin:8px 0;padding-left:20px}
.setup-hint li{margin:4px 0}
.setup-hint a{color:var(--green);text-decoration:none}
.setup-hint a:hover{text-decoration:underline}
.setup-hint strong{color:var(--text);font-weight:500}
.form-row{display:flex;gap:0;border:1px solid var(--border);margin-bottom:-1px}
.form-row:last-child{margin-bottom:0}
.form-row label{padding:12px 16px;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);min-width:140px;display:flex;align-items:center;border-right:1px solid var(--border);white-space:nowrap}
.form-row input{background:transparent;border:none;padding:12px 16px;color:var(--text);font-size:12px;font-family:inherit;outline:none;flex:1}
.form-row input::placeholder{color:#333}
.form-actions{display:flex;gap:0;margin-top:16px}
.form-actions button{padding:12px 24px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;font-family:inherit;border:1px solid var(--border);transition:all .1s}
.form-actions .btn-primary{background:#fff;color:#000;border-color:#fff}
.form-actions .btn-primary:hover{opacity:.8}
.form-actions .btn-danger{background:transparent;color:var(--red);border-color:var(--border);margin-left:-1px}
.form-actions .btn-danger:hover{background:var(--red-bg);border-color:var(--red)}
.props-layout{display:grid;grid-template-columns:320px 1fr;gap:0;min-height:60vh}
.props-sidebar{border-right:1px solid var(--border);padding:0}
.props-sidebar-title{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);padding:20px 20px 12px}
.props-main{padding:0 0 0 32px}
.prop-item{padding:12px 20px;border-bottom:1px solid var(--border);transition:background .1s;cursor:default}
.prop-item:hover{background:var(--surface-hover)}
.prop-item.editing{background:var(--surface-hover);border-left:2px solid var(--green);padding-left:18px}
.prop-item-header{display:flex;align-items:center;justify-content:space-between}
.prop-item-name{font-size:13px;font-weight:500;letter-spacing:.02em}
.prop-item-actions{display:flex;gap:4px;opacity:0;transition:opacity .15s}
.prop-item:hover .prop-item-actions{opacity:1}
.prop-item-actions a,.prop-item-actions button{background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px 6px;border-radius:3px;display:flex;align-items:center;text-decoration:none;transition:all .1s}
.prop-item-actions a:hover{color:var(--text);background:rgba(255,255,255,.06)}
.prop-item-actions button:hover{color:var(--red);background:rgba(255,77,77,.08)}
.prop-item-details{font-size:11px;color:var(--text-muted);margin-top:2px;display:flex;align-items:center;gap:6px}
.prop-item-details .dot{opacity:.3}
.prop-form-panel{padding-top:20px}
.prop-form-title{font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;margin:0 0 16px}
.btn-cancel{padding:12px 24px;font-size:11px;color:var(--text-muted);text-decoration:none;border:1px solid var(--border);margin-left:-1px;display:flex;align-items:center;transition:all .1s}
.btn-cancel:hover{color:var(--text);border-color:var(--text)}
.props-empty{padding:40px 20px;text-align:center;color:var(--text-muted);font-size:12px}
@media(max-width:768px){.props-layout{grid-template-columns:1fr;gap:24px}.props-sidebar{border-right:none;border-bottom:1px solid var(--border);padding-bottom:16px}.props-main{padding:0}}
`;

/** Client-side JS for dropdowns and label editing. */
export const JS = `
document.addEventListener('click', function(e) {
  var trigger = e.target.closest('.dd-trigger');
  var item = e.target.closest('.dd-item');
  if (trigger) {
    var dd = trigger.closest('.dd');
    document.querySelectorAll('.dd.open').forEach(function(other) {
      if (other !== dd) other.classList.remove('open');
    });
    dd.classList.toggle('open');
    e.stopPropagation();
    return;
  }
  if (item) {
    var link = item.querySelector('a');
    if (link) { link.click(); return; }
    var dd = item.closest('.dd');
    var value = item.dataset.value;
    var hiddenInput = dd.querySelector('input[type=hidden]');
    var triggerEl = dd.querySelector('.dd-trigger');
    hiddenInput.value = value;
    triggerEl.childNodes[0].textContent = item.textContent;
    dd.querySelectorAll('.dd-item').forEach(function(i) { i.classList.remove('dd-active'); });
    item.classList.add('dd-active');
    dd.classList.remove('open');
    return;
  }
  document.querySelectorAll('.dd.open').forEach(function(dd) { dd.classList.remove('open'); });
});
function editLabel(url, el) {
  var td = el.parentElement;
  var current = el.dataset.label || '';
  td.innerHTML = '<form class="lbl-form" onsubmit="saveLabel(this,event)"><input class="lbl-edit" name="label" value="'+current+'" data-url="'+encodeURIComponent(url)+'" autofocus></form>';
  td.querySelector('input').focus();
  td.querySelector('input').addEventListener('blur', function(e) {
    if (!e.relatedTarget || !e.relatedTarget.closest('.lbl-form')) saveLabel(this.closest('form'), e);
  });
}
function saveLabel(form, e) {
  e.preventDefault();
  var input = form.querySelector('input');
  var url = decodeURIComponent(input.dataset.url);
  var label = input.value.trim();
  fetch('/api/label', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({url: url, label: label || null})
  }).then(function() { location.reload(); });
}
function bulkLabel(form, e) {
  e.preventDefault();
  var label = form.querySelector('[name=bulk_label]').value.trim();
  var params = new URLSearchParams(window.location.search);
  fetch('/api/bulk-label', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      label: label || null,
      q: params.get('q') || '',
      status: params.get('status') || '',
      labelFilter: params.get('label') || ''
    })
  }).then(function(r) { return r.json(); })
    .then(function(d) { alert(d.updated + ' pages updated'); location.reload(); });
}
`;
