import { api, html, render, fail, LOGO_SVG, raw, state } from '../lib.js';
import { afterLogin } from '../app.js';

const art = (h1, p) => html`<div class="art"><div class="logo" style="padding:0">${raw(LOGO_SVG)}<span>KESS <small>Cloud</small></span></div>
  <div><h1>${raw(h1)}</h1><p>${p}</p></div><p class="small">© ${new Date().getFullYear()} Kess Media · Sydney</p></div>`;

export async function login(el) {
  if (state.user) { location.hash = '#/'; return; }
  render(el, html`<div class="auth">${art('Websites, hosting and care, <em>in one place.</em>', 'Sign in to see your sites, approve changes, send requests and check invoices.')}
    <div class="panel"><form id="f" class="form"><h2>Sign in</h2>
      <label class="f">Email<input class="i" name="email" type="email" autocomplete="username" required autofocus></label>
      <label class="f">Password<input class="i" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary" style="justify-content:center;padding:10px">Sign in</button>
      <p class="muted small">Forgot your password? Ask Kess Media for a new sign-in link.</p></form></div></div>`);
  el.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
      await afterLogin('#/');
    } catch (err) { fail(err); }
  });
}

export async function invite(el, { token }) {
  let info;
  try { info = await api(`/api/auth/invite/${encodeURIComponent(token)}`); }
  catch (e) { render(el, html`<div class="auth">${art('This link has <em>expired.</em>', e.message)}<div class="panel"><a class="btn" href="#/login">Go to sign in</a></div></div>`); return; }
  render(el, html`<div class="auth">${art(`Welcome, <em>${info.name.replace(/[<>&"]/g, '')}.</em>`, 'Choose a password to finish setting up your Kess Cloud account.')}
    <div class="panel"><form id="f" class="form"><h2>Set your password</h2><p class="muted" style="margin:0">${info.email}</p>
      <label class="f">New password <span class="hint">at least 10 characters</span><input class="i" name="password" type="password" minlength="10" autocomplete="new-password" required autofocus></label>
      <button class="btn primary" style="justify-content:center;padding:10px">Continue</button></form></div></div>`);
  el.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/auth/invite/${encodeURIComponent(token)}`, { method: 'POST', body: { password: new FormData(e.target).get('password') } });
      await afterLogin('#/');
    } catch (err) { fail(err); }
  });
}
