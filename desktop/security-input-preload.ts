import { spacing } from '../src/theme/spacing';
import { ipcRenderer } from 'electron';
import type { SecurityInputConfig } from './security-input';

// This preload exposes no API to the host or document world and loads no business runtime.
const channel = 'psstpsst:trusted-input';
window.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    const config = await ipcRenderer.invoke(channel, 'config') as SecurityInputConfig;
    const style = document.createElement('style'); style.nonce = 'psst-security';
    style.textContent = `:root{color-scheme:light dark}body{font:menu;background:Canvas;color:CanvasText;margin:${spacing.xl}px}
      main,form{display:grid;gap:${spacing.md}px}h1,p{margin:0}p{white-space:pre-wrap}h1{font:inherit;font-weight:bold}
      label{display:grid;gap:${spacing.sm}px}input,button,textarea{font:inherit;box-sizing:border-box;max-width:100%}
      input{width:100%;padding:${spacing.sm}px}textarea{width:100%}.actions{display:flex;gap:${spacing.sm}px;justify-content:flex-end}
      button{padding:${spacing.sm}px ${spacing.md}px}`;
    document.head.append(style);
    document.title = config.title; document.documentElement.dir = 'auto';
    const main = document.createElement('main');
    const title = document.createElement('h1'); title.textContent = config.title; main.append(title);
    const message = document.createElement('p'); message.textContent = config.message; main.append(message);
    if (config.details) { const details = document.createElement('textarea'); details.readOnly = true; details.rows = 6; details.cols = 44; details.value = config.details; details.setAttribute('aria-label', config.title); main.append(details); }
    const form = document.createElement('form');
    const input = (label: string) => {
      const container = document.createElement('p'), field = document.createElement('input'), text = document.createElement('label');
      field.type = 'password'; field.maxLength = config.numeric ? 6 : 256; field.autocomplete = 'off'; field.spellcheck = false;
      if (config.numeric) { field.inputMode = 'numeric'; field.pattern = '[0-9]{6}'; }
      field.required = true; field.minLength = config.numeric ? 6 : 8; text.textContent = label; text.append(field); container.append(text); form.append(container);
      return field;
    };
    const value = config.input ? input(config.input) : null;
    const confirmation = config.confirmation ? input(config.confirmation) : null;
    const error = document.createElement('p'); error.setAttribute('role', 'alert'); form.append(error);
    form.addEventListener('input', () => { error.textContent = ''; });
    const confirm = document.createElement('button'); confirm.type = 'submit'; confirm.textContent = config.confirm;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = config.cancel;
    cancel.addEventListener('click', () => { void ipcRenderer.invoke(channel, 'cancel'); });
    const actions = document.createElement('div'); actions.className = 'actions'; actions.append(cancel, confirm); form.append(actions); main.append(form); document.body.replaceChildren(main); value?.focus();
    form.addEventListener('submit', event => {
      event.preventDefault(); if (confirm.disabled) return;
      const candidate = value?.value ?? '', repeated = confirmation?.value ?? '';
      if (confirmation && candidate !== repeated) { error.textContent = config.error; return; }
      confirm.disabled = true;
      void ipcRenderer.invoke(channel, 'submit', { value: candidate, confirmation: repeated }).then(ok => {
        if (!ok) { error.textContent = config.error; if (value) { value.value = ''; value.focus(); } }
      }).finally(() => { confirm.disabled = false; });
    });
  })();
});
