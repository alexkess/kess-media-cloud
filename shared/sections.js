// Single source of truth for page sections.
// The same schema drives: the editor UI (browser), the HTML renderer (server
// hosting + previews), and the Sanity schema in the Astro + Sanity export.

export const SECTION_TYPES = {
  hero: {
    label: 'Hero',
    fields: [
      { key: 'style', label: 'Style', type: 'select', options: ['dark', 'light', 'image'], default: 'dark' },
      { key: 'eyebrow', label: 'Eyebrow', type: 'text' },
      { key: 'heading', label: 'Heading', type: 'text', required: true },
      { key: 'accent', label: 'Accent (italic second half)', type: 'text' },
      { key: 'text', label: 'Intro text', type: 'textarea' },
      { key: 'image', label: 'Image URL', type: 'image' },
      { key: 'imageAlt', label: 'Image alt text', type: 'text' },
      { key: 'ctaLabel', label: 'Button label', type: 'text' },
      { key: 'ctaHref', label: 'Button link', type: 'text' },
    ],
  },
  text: {
    label: 'Text block',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'accent', label: 'Accent', type: 'text' },
      { key: 'body', label: 'Body (blank line = new paragraph, **bold**, [link](url))', type: 'richtext' },
      { key: 'tone', label: 'Background', type: 'select', options: ['plain', 'soft', 'dark'], default: 'plain' },
    ],
  },
  features: {
    label: 'Features / services',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'accent', label: 'Accent', type: 'text' },
      { key: 'items', label: 'Items', type: 'list', fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'text', label: 'Text', type: 'textarea' },
      ] },
    ],
  },
  stats: {
    label: 'Stats',
    fields: [
      { key: 'items', label: 'Stats', type: 'list', fields: [
        { key: 'value', label: 'Value', type: 'text' },
        { key: 'label', label: 'Label', type: 'text' },
      ] },
    ],
  },
  gallery: {
    label: 'Image gallery',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'images', label: 'Images', type: 'list', fields: [
        { key: 'src', label: 'Image URL', type: 'image' },
        { key: 'alt', label: 'Alt text', type: 'text' },
        { key: 'caption', label: 'Caption', type: 'text' },
      ] },
    ],
  },
  testimonials: {
    label: 'Testimonials',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'items', label: 'Quotes', type: 'list', fields: [
        { key: 'quote', label: 'Quote', type: 'textarea' },
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'role', label: 'Role / organisation', type: 'text' },
      ] },
    ],
  },
  faq: {
    label: 'FAQ',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'items', label: 'Questions', type: 'list', fields: [
        { key: 'q', label: 'Question', type: 'text' },
        { key: 'a', label: 'Answer', type: 'textarea' },
      ] },
    ],
  },
  cta: {
    label: 'Call to action',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'accent', label: 'Accent', type: 'text' },
      { key: 'text', label: 'Text', type: 'textarea' },
      { key: 'ctaLabel', label: 'Button label', type: 'text' },
      { key: 'ctaHref', label: 'Button link', type: 'text' },
    ],
  },
  contact: {
    label: 'Contact form',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'accent', label: 'Accent', type: 'text' },
      { key: 'text', label: 'Text', type: 'textarea' },
      { key: 'showPhone', label: 'Ask for phone number', type: 'boolean', default: true },
      { key: 'submitLabel', label: 'Button label', type: 'text', default: 'Send message' },
      { key: 'successText', label: 'Thank-you message', type: 'text', default: "Thanks, we'll be in touch soon." },
    ],
  },
};

export const FONT_CHOICES = {
  body: ['Inter', 'DM Sans', 'Work Sans', 'Source Sans 3', 'Lora'],
  accent: ['Playfair Display', 'Fraunces', 'DM Serif Display', 'none'],
};

export const THEME_PRESETS = {
  kess: { label: 'Kess (forest + mint)', colors: { bg: '#ffffff', soft: '#E8EDE6', text: '#1a1a1a', muted: '#666666', primary: '#1E5C34', accent: '#7BBF9A', dark: '#1a1a1a', onDark: '#F2EDE6' }, fonts: { body: 'Inter', accent: 'Playfair Display' }, radius: 10 },
  ocean: { label: 'Ocean', colors: { bg: '#ffffff', soft: '#E6F0F5', text: '#10222e', muted: '#5b6b75', primary: '#0E5A7A', accent: '#5FC1D9', dark: '#0b1d27', onDark: '#EAF4F8' }, fonts: { body: 'DM Sans', accent: 'Fraunces' }, radius: 12 },
  clay: { label: 'Clay', colors: { bg: '#FBF8F4', soft: '#F2E8DE', text: '#2b211c', muted: '#7a6a60', primary: '#9A4A2B', accent: '#E3A57E', dark: '#2b211c', onDark: '#FBF3EA' }, fonts: { body: 'Work Sans', accent: 'DM Serif Display' }, radius: 6 },
  mono: { label: 'Mono', colors: { bg: '#ffffff', soft: '#F2F2F2', text: '#111111', muted: '#6b6b6b', primary: '#111111', accent: '#BDBDBD', dark: '#111111', onDark: '#f5f5f5' }, fonts: { body: 'Inter', accent: 'none' }, radius: 0 },
};

export function defaultTheme(preset = 'kess') {
  const p = THEME_PRESETS[preset] || THEME_PRESETS.kess;
  return { preset, colors: { ...p.colors }, fonts: { ...p.fonts }, radius: p.radius };
}

export function blankSection(type) {
  const def = SECTION_TYPES[type];
  if (!def) throw new Error(`Unknown section type: ${type}`);
  const s = { type };
  for (const f of def.fields) {
    if (f.type === 'list') s[f.key] = [];
    else if (f.default !== undefined) s[f.key] = f.default;
    else s[f.key] = '';
  }
  return s;
}

// ---------- escaping helpers ----------
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function safeUrl(u) {
  const s = String(u ?? '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:)/i.test(s) || s.startsWith('/') || s.startsWith('#')) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return ''; // javascript:, data:, etc.
  return s; // relative path like "contact"
}

function inline(text) {
  let s = esc(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*(.+?)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    // url was escaped already; unescape &amp; for checking
    const raw = url.replace(/&amp;/g, '&');
    const ok = safeUrl(raw);
    return ok ? `<a href="${esc(ok)}">${label}</a>` : label;
  });
  return s;
}

export function richText(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (/^(- |\* )/.test(p)) {
        const lis = p.split('\n').map((l) => l.replace(/^(- |\* )/, '').trim()).filter(Boolean);
        return `<ul>${lis.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`;
      }
      return `<p>${inline(p).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

function heading(tag, s, cls = '') {
  if (!s.heading && !s.accent) return '';
  const acc = s.accent ? ` <em>${esc(s.accent)}</em>` : '';
  return `<${tag}${cls ? ` class="${cls}"` : ''}>${esc(s.heading)}${acc}</${tag}>`;
}

function button(label, href, link, cls = 'btn') {
  if (!label) return '';
  return `<a class="${cls}" href="${esc(link(href))}">${esc(label)}</a>`;
}

// ---------- section renderers ----------
const R = {
  hero(s, ctx) {
    const style = s.style || 'dark';
    const bg = style === 'image' && s.image ? ` style="--hero-img:url('${esc(safeUrl(s.image))}')"` : '';
    const img = style !== 'image' && s.image
      ? `<div class="hero-media"><img src="${esc(safeUrl(s.image))}" alt="${esc(s.imageAlt)}" loading="eager"></div>` : '';
    return `<section class="sec hero hero-${esc(style)}"${bg}><div class="wrap hero-grid${img ? ' has-media' : ''}"><div class="hero-copy">
      ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}
      ${heading('h1', s)}
      ${s.text ? `<p class="lead">${esc(s.text)}</p>` : ''}
      ${button(s.ctaLabel, s.ctaHref, ctx.link)}
    </div>${img}</div></section>`;
  },
  text(s) {
    return `<section class="sec text tone-${esc(s.tone || 'plain')}"><div class="wrap narrow">${heading('h2', s)}<div class="prose">${richText(s.body)}</div></div></section>`;
  },
  features(s) {
    const items = (s.items || []).map((i) => `<div class="card"><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join('');
    return `<section class="sec features"><div class="wrap">${heading('h2', s)}<div class="grid">${items}</div></div></section>`;
  },
  stats(s) {
    const items = (s.items || []).map((i) => `<div class="stat"><strong>${esc(i.value)}</strong><span>${esc(i.label)}</span></div>`).join('');
    return `<section class="sec stats tone-dark"><div class="wrap stat-row">${items}</div></section>`;
  },
  gallery(s) {
    const items = (s.images || []).filter((i) => i.src).map((i) => `<figure><img src="${esc(safeUrl(i.src))}" alt="${esc(i.alt)}" loading="lazy">${i.caption ? `<figcaption>${esc(i.caption)}</figcaption>` : ''}</figure>`).join('');
    return `<section class="sec gallery"><div class="wrap">${heading('h2', s)}<div class="gal">${items}</div></div></section>`;
  },
  testimonials(s) {
    const items = (s.items || []).map((i) => `<blockquote><p>“${esc(i.quote)}”</p><footer><strong>${esc(i.name)}</strong>${i.role ? `, ${esc(i.role)}` : ''}</footer></blockquote>`).join('');
    return `<section class="sec testimonials tone-soft"><div class="wrap">${heading('h2', s)}<div class="grid">${items}</div></div></section>`;
  },
  faq(s) {
    const items = (s.items || []).map((i) => `<details><summary>${esc(i.q)}</summary><div class="prose">${richText(i.a)}</div></details>`).join('');
    return `<section class="sec faq"><div class="wrap narrow">${heading('h2', s)}${items}</div></section>`;
  },
  cta(s, ctx) {
    return `<section class="sec cta tone-dark"><div class="wrap narrow center">${heading('h2', s)}${s.text ? `<p class="lead">${esc(s.text)}</p>` : ''}${button(s.ctaLabel, s.ctaHref, ctx.link, 'btn btn-accent')}</div></section>`;
  },
  contact(s, ctx) {
    const phone = s.showPhone !== false && s.showPhone !== 'false'
      ? '<label>Phone<input name="phone" type="tel" autocomplete="tel"></label>' : '';
    return `<section class="sec contact tone-soft" id="contact"><div class="wrap narrow">${heading('h2', s)}${s.text ? `<p class="lead">${esc(s.text)}</p>` : ''}
      <form class="kform" method="post" action="${esc(ctx.formAction)}" data-success="${esc(s.successText || "Thanks, we'll be in touch soon.")}">
        <input type="hidden" name="_page" value="${esc(ctx.page.slug)}">
        <div class="hp" aria-hidden="true"><label>Leave blank<input name="_hp" tabindex="-1" autocomplete="off"></label></div>
        <label>Name<input name="name" required autocomplete="name"></label>
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        ${phone}
        <label>Message<textarea name="message" rows="5" required></textarea></label>
        <button class="btn" type="submit">${esc(s.submitLabel || 'Send message')}</button>
        <p class="form-status" role="status"></p>
      </form></div></section>`;
  },
};

export function renderSection(s, ctx) {
  const fn = R[s?.type];
  return fn ? fn(s, ctx) : '';
}

// ---------- full page ----------
export function themeCss(theme) {
  const t = theme || defaultTheme();
  const c = t.colors;
  const accentFont = t.fonts.accent && t.fonts.accent !== 'none' ? `'${t.fonts.accent}', Georgia, serif` : 'inherit';
  return `:root{--bg:${c.bg};--soft:${c.soft};--text:${c.text};--muted:${c.muted};--primary:${c.primary};--accent:${c.accent};--dark:${c.dark};--on-dark:${c.onDark};--radius:${Number(t.radius) || 0}px;--font:'${t.fonts.body}',system-ui,sans-serif;--font-accent:${accentFont};--accent-style:${t.fonts.accent === 'none' ? 'normal' : 'italic'}}`;
}

export const BASE_CSS = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:var(--font);color:var(--text);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}a{color:var(--primary)}.wrap{max-width:1120px;margin:0 auto;padding:0 24px}.narrow{max-width:760px}.center{text-align:center}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:#fff;padding:8px;z-index:9}
header.site{position:sticky;top:0;z-index:5;background:var(--dark);color:var(--on-dark)}header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:68px}
.brand{font-weight:800;letter-spacing:.02em;color:var(--on-dark);text-decoration:none;font-size:1.15rem}.brand img{height:34px}
nav.main ul{list-style:none;display:flex;gap:22px;margin:0;padding:0;flex-wrap:wrap}nav.main a{color:var(--on-dark);text-decoration:none;opacity:.85;font-size:.95rem}nav.main a[aria-current]{opacity:1;border-bottom:2px solid var(--accent)}
.navtoggle{display:none;background:none;border:1px solid currentColor;color:var(--on-dark);border-radius:6px;padding:6px 10px}
@media(max-width:720px){.navtoggle{display:block}nav.main{display:none;position:absolute;left:0;right:0;top:68px;background:var(--dark);padding:16px 24px}nav.main.open{display:block}nav.main ul{flex-direction:column;gap:12px}}
.sec{padding:84px 0}h1,h2,h3{line-height:1.12;margin:0 0 .5em;font-weight:700}h1{font-size:clamp(2.2rem,5vw,3.6rem)}h2{font-size:clamp(1.7rem,3.4vw,2.4rem)}h3{font-size:1.15rem}
h1 em,h2 em{font-family:var(--font-accent);font-style:var(--accent-style);color:var(--primary)}.tone-dark h1 em,.tone-dark h2 em,.hero-dark h1 em,.hero-image h1 em{color:var(--accent)}
.lead{font-size:1.15rem;color:var(--muted);max-width:60ch}.tone-dark .lead,.hero-dark .lead,.hero-image .lead{color:var(--on-dark);opacity:.85}
.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:.78rem;font-weight:700;color:var(--primary)}.hero-dark .eyebrow,.hero-image .eyebrow{color:var(--accent)}
.btn{display:inline-block;background:var(--primary);color:#fff;padding:13px 26px;border-radius:999px;text-decoration:none;font-weight:600;border:0;font:inherit;font-weight:600;cursor:pointer}.btn:hover{filter:brightness(1.1)}.btn-accent{background:var(--accent);color:var(--dark)}
.hero{padding:110px 0}.hero-dark{background:var(--dark);color:var(--on-dark)}.hero-light{background:var(--soft)}
.hero-image{background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,.7)),var(--hero-img) center/cover;color:#fff;padding:150px 0}
.hero-grid.has-media{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}.hero-media img{border-radius:var(--radius);aspect-ratio:4/3;object-fit:cover;width:100%}
@media(max-width:820px){.hero-grid.has-media{grid-template-columns:1fr}}
.tone-soft{background:var(--soft)}.tone-dark{background:var(--dark);color:var(--on-dark)}.tone-dark a{color:var(--accent)}
.prose p{margin:0 0 1em}.prose ul{padding-left:1.2em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-top:28px}.card{background:var(--soft);border-radius:var(--radius);padding:26px}.card p{margin:0;color:var(--muted)}
.stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:24px;text-align:center}.stat strong{display:block;font-size:2.6rem;color:var(--accent);font-family:var(--font-accent);font-style:var(--accent-style)}.stat span{opacity:.8}.stats{padding:56px 0}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:24px}.gal figure{margin:0}.gal img{aspect-ratio:4/3;object-fit:cover;width:100%;border-radius:var(--radius)}.gal figcaption{font-size:.85rem;color:var(--muted);margin-top:6px}
blockquote{margin:0;background:var(--bg);border-radius:var(--radius);padding:26px;border-left:4px solid var(--accent)}blockquote p{font-size:1.05rem;margin:0 0 12px}blockquote footer{color:var(--muted);font-size:.9rem}
details{border-bottom:1px solid rgba(0,0,0,.12);padding:16px 0}summary{cursor:pointer;font-weight:600;font-size:1.05rem}details .prose{margin-top:10px;color:var(--muted)}
.kform{display:grid;gap:14px;margin-top:20px}.kform label{display:grid;gap:6px;font-weight:600;font-size:.92rem}.kform input,.kform textarea{font:inherit;padding:12px 14px;border:1px solid rgba(0,0,0,.2);border-radius:calc(var(--radius) / 2 + 2px);background:#fff}.kform .hp{position:absolute;left:-5000px}.form-status{min-height:1.4em;font-weight:600;color:var(--primary)}
footer.site{background:var(--dark);color:var(--on-dark);padding:40px 0;font-size:.9rem}footer.site .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}footer.site a{color:var(--accent)}
.preview-bar{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:#111;color:#fff;font:600 12px system-ui;padding:6px 14px;border-radius:99px;z-index:99;opacity:.85}`;

const RUNTIME_JS = `(function(){var t=document.querySelector('.navtoggle'),n=document.querySelector('nav.main');if(t&&n)t.addEventListener('click',function(){var o=n.classList.toggle('open');t.setAttribute('aria-expanded',o)});
document.querySelectorAll('form.kform').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var s=f.querySelector('.form-status'),b=f.querySelector('button');b.disabled=true;s.textContent='Sending...';
var d={};new FormData(f).forEach(function(v,k){d[k]=v});fetch(f.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Error');s.textContent=f.dataset.success;f.reset()})}).catch(function(err){s.textContent='Sorry, that did not send. '+err.message}).finally(function(){b.disabled=false})})});
var h=document.documentElement.dataset.hit;if(h&&navigator.sendBeacon){try{navigator.sendBeacon(h,JSON.stringify({p:location.pathname,r:document.referrer}))}catch(e){}}})();`;

export function fontsLink(theme) {
  const fams = new Set([theme.fonts.body]);
  if (theme.fonts.accent && theme.fonts.accent !== 'none') fams.add(theme.fonts.accent);
  const q = [...fams].map((f) => {
    const name = f.replace(/ /g, '+');
    if (['Playfair Display', 'Fraunces'].includes(f)) return `family=${name}:ital,wght@0,400;0,700;1,400;1,700`;
    if (f === 'DM Serif Display') return `family=${name}:ital@0;1`;
    return `family=${name}:wght@400;600;700;800`;
  });
  return `https://fonts.googleapis.com/css2?${q.join('&')}&display=swap`;
}

/**
 * Render a full HTML page.
 * snapshot = { site: {name, settings}, theme, pages: [{slug,title,description,sections,inNav}] }
 * opts = { base, formAction, hitUrl, preview, canonicalBase }
 */
export function renderPage(snapshot, pageSlug, opts = {}) {
  const { theme, pages } = snapshot;
  const site = snapshot.site || {};
  const settings = site.settings || {};
  const page = pages.find((p) => p.slug === pageSlug);
  if (!page) return null;
  const base = (opts.base || '').replace(/\/$/, '');
  const pageHref = (slug) => (slug ? `${base}/${slug}` : `${base}/`);
  const link = (href) => {
    const u = safeUrl(href);
    if (!u) return '#';
    if (/^(https?:|mailto:|tel:|#)/i.test(u)) return u;
    if (u.startsWith('/')) return base + u;
    return pageHref(u);
  };
  const ctx = { link, page, formAction: opts.formAction || '#' };
  const nav = pages.filter((p) => p.inNav !== false).map((p) => `<li><a href="${esc(pageHref(p.slug))}"${p.slug === page.slug ? ' aria-current="page"' : ''}>${esc(p.navLabel || p.title)}</a></li>`).join('');
  const title = page.slug === '' ? `${site.name}${settings.tagline ? ` | ${settings.tagline}` : ''}` : `${page.title} | ${site.name}`;
  const desc = page.description || settings.description || '';
  const canonical = opts.canonicalBase ? `${opts.canonicalBase.replace(/\/$/, '')}${page.slug ? '/' + page.slug : '/'}` : '';
  const ogImage = settings.ogImage || (page.sections.find((s) => s.type === 'hero' && s.image) || {}).image || '';
  const brand = settings.logo ? `<img src="${esc(safeUrl(settings.logo))}" alt="${esc(site.name)}">` : esc(site.name);
  const footerBits = [settings.email && `<a href="mailto:${esc(settings.email)}">${esc(settings.email)}</a>`, settings.phone && `<a href="tel:${esc(settings.phone.replace(/\s/g, ''))}">${esc(settings.phone)}</a>`, settings.address && esc(settings.address)].filter(Boolean).join(' · ');
  const ld = { '@context': 'https://schema.org', '@type': settings.schemaType || 'Organization', name: site.name, ...(settings.email ? { email: settings.email } : {}), ...(settings.phone ? { telephone: settings.phone } : {}), ...(opts.canonicalBase ? { url: opts.canonicalBase } : {}) };
  return `<!doctype html><html lang="${esc(settings.lang || 'en-AU')}"${opts.hitUrl ? ` data-hit="${esc(opts.hitUrl)}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${desc ? `<meta name="description" content="${esc(desc)}">` : ''}${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:title" content="${esc(title)}">${desc ? `<meta property="og:description" content="${esc(desc)}">` : ''}${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
${opts.preview ? '<meta name="robots" content="noindex">' : ''}<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${fontsLink(theme)}">
<style>${themeCss(theme)}${BASE_CSS}</style><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script></head>
<body><a class="skip" href="#main">Skip to content</a><header class="site"><div class="wrap"><a class="brand" href="${esc(pageHref(''))}">${brand}</a><button class="navtoggle" aria-expanded="false" aria-controls="nav">Menu</button><nav class="main" id="nav" aria-label="Main"><ul>${nav}</ul></nav></div></header>
<main id="main">${page.sections.map((s) => renderSection(s, ctx)).join('\n')}</main>
<footer class="site"><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(site.name)}</span><span>${footerBits}</span></div></footer>
${opts.preview ? `<div class="preview-bar">${esc(opts.preview)}</div>` : ''}<script>${RUNTIME_JS}</script></body></html>`;
}

// ---------- SEO / quality audit ----------
export function auditPage(snapshot, page) {
  const issues = [];
  const settings = snapshot.site?.settings || {};
  const title = page.slug === '' ? snapshot.site?.name : page.title;
  const desc = page.description || settings.description || '';
  if (!title) issues.push({ level: 'error', msg: 'Page has no title' });
  if (!desc) issues.push({ level: 'error', msg: 'Missing meta description' });
  else if (desc.length < 70) issues.push({ level: 'warn', msg: `Meta description is short (${desc.length} chars, aim for 120-160)` });
  else if (desc.length > 165) issues.push({ level: 'warn', msg: `Meta description is long (${desc.length} chars, aim for 120-160)` });
  const heroes = page.sections.filter((s) => s.type === 'hero' && s.heading);
  if (heroes.length === 0) issues.push({ level: 'warn', msg: 'No hero heading, so the page has no H1' });
  if (heroes.length > 1) issues.push({ level: 'warn', msg: 'More than one H1 (multiple hero sections)' });
  for (const s of page.sections) {
    if (s.type === 'hero' && s.image && !s.imageAlt) issues.push({ level: 'error', msg: 'Hero image is missing alt text' });
    if (s.type === 'gallery') (s.images || []).forEach((im, i) => { if (im.src && !im.alt) issues.push({ level: 'error', msg: `Gallery image ${i + 1} is missing alt text` }); });
    for (const k of ['ctaHref']) if (s[k] && !safeUrl(s[k])) issues.push({ level: 'error', msg: `Unsafe or invalid link in ${s.type} section` });
    if ((s.type === 'features' || s.type === 'faq' || s.type === 'testimonials') && !(s.items || []).length) issues.push({ level: 'warn', msg: `${SECTION_TYPES[s.type].label} section has no items` });
  }
  if (!page.sections.length) issues.push({ level: 'error', msg: 'Page is empty' });
  const words = page.sections.map((s) => JSON.stringify(s)).join(' ').split(/\s+/).length;
  if (words < 120 && page.sections.length) issues.push({ level: 'info', msg: 'Thin content: consider adding more copy for search' });
  const score = Math.max(0, 100 - issues.reduce((n, i) => n + (i.level === 'error' ? 15 : i.level === 'warn' ? 6 : 2), 0));
  return { slug: page.slug, title: page.title, score, issues };
}
