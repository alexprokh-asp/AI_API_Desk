/* OpenAI API Desk — plain JavaScript, no dependencies, no build step.
   Sections: 1 helpers · 2 markdown + highlighting · 3 model capabilities · 4 API layer
             5 state + connection · 6 models + capability UI · 7 request builder · 8 inspector
             9 attachments · 10 run + rendering · 11 knowledge base · 12 layout + wiring */
(() => {
'use strict';

/* ============================================================
   1. Helpers
   ============================================================ */
const API_BASE = 'https://api.openai.com/v1';
const RESPONSES_URL = API_BASE + '/responses';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALL_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_LABELS = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtNum = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');
const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);
const stamp = () => new Date().toLocaleTimeString('en-GB');

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr-copy';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  return ok;
}
async function flashCopy(btn, text) {
  const ok = await copyText(text);
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => { btn.textContent = old; }, 1200);
}
function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Shorten very long base64 strings for display only. Copy/Download always use the full data. */
function shorten(v) {
  if (typeof v === 'string') {
    const m = /^data:[^;,]+;base64,/.exec(v);
    if (m && v.length > 200) return v.slice(0, m[0].length + 40) + `…[${v.length.toLocaleString('en-US')} chars]`;
    if (v.length > 2000 && /^[A-Za-z0-9+/=\s]+$/.test(v)) return v.slice(0, 40) + `…[base64, ${v.length.toLocaleString('en-US')} chars]`;
    return v;
  }
  if (Array.isArray(v)) return v.map(shorten);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = shorten(v[k]); return o; }
  return v;
}
function flatten(obj, prefix = '', out = []) {
  for (const k of Object.keys(obj || {})) {
    const v = obj[k], key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.push([key, Array.isArray(v) ? JSON.stringify(v) : String(v)]);
  }
  return out;
}

/* ============================================================
   2. Markdown renderer (HTML is escaped first — no raw HTML passes through) + code highlighting
   ============================================================ */
const Highlight = (() => {
  const set = (s) => new Set(s.split(' '));
  const js = { kw: set('const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this null undefined true false yield static super delete void'), line: ['//'], block: true, tpl: true };
  const py = { kw: set('def class return if elif else for while in not and or is None True False import from as with try except finally raise lambda pass break continue yield async await global nonlocal assert del self'), line: ['#'], triple: true };
  const sh = { kw: set('if then else elif fi for while do done case esac function in echo export local return exit cd ls cat grep sed awk curl git npm pip sudo'), line: ['#'], dash: true };
  const clike = { kw: set('if else for while do switch case break continue return function func fn let var const static struct class interface enum public private protected new this true false null nil void int long char float double bool string package import use type impl trait mut match async await'), line: ['//'], block: true };
  const sql = { kw: set('select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit as distinct null is in like count sum avg min max'), line: ['--'], block: true, ci: true };
  const css = { kw: set('important'), line: [], block: true, dash: true };
  const yaml = { kw: set('true false null yes no'), line: ['#'], keys: true, dash: true };
  const json = { kw: set('true false null'), line: [], keys: true };
  const LANGS = { js, javascript: js, jsx: js, ts: js, typescript: js, tsx: js, mjs: js, py, python: py, sh, bash: sh, shell: sh, zsh: sh, curl: sh, c: clike, cpp: clike, java: clike, go: clike, rust: clike, rs: clike, cs: clike, csharp: clike, php: clike, swift: clike, kotlin: clike, sql, css, scss: css, yaml, yml: yaml, json, jsonc: json };
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

  function markup(code) {
    const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?[A-Za-z][\w:-]*)|("[^"\n]*"|'[^'\n]*')|(\/?>)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const cls = m[1] ? 'tk-c' : m[2] ? 'tk-k' : m[3] ? 'tk-s' : 'tk-k';
      out += `<span class="${cls}">${esc(m[0])}</span>`;
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  function run(code, lang) {
    lang = (lang || '').toLowerCase();
    if (lang === 'html' || lang === 'xml' || lang === 'svg' || lang === 'markup') return markup(code);
    const cfg = LANGS[lang];
    if (!cfg || code.length > 200000) return esc(code);
    const comment = [];
    if (cfg.block) comment.push('\\/\\*[\\s\\S]*?(?:\\*\\/|$)');
    for (const l of cfg.line) comment.push(reEsc(l) + '[^\\n]*');
    const str = (cfg.triple ? '"""[\\s\\S]*?(?:"""|$)|\'\'\'[\\s\\S]*?(?:\'\'\'|$)|' : '') +
      '"(?:[^"\\\\\\n]|\\\\.)*"?|\'(?:[^\'\\\\\\n]|\\\\.)*\'?' + (cfg.tpl ? '|`(?:[^`\\\\]|\\\\.)*`?' : '');
    const word = '[A-Za-z_$][\\w$' + (cfg.dash ? '-' : '') + ']*';
    const re = new RegExp('(' + (comment.length ? comment.join('|') : '(?!)') + ')|(' + str + ')|(\\b0x[0-9a-fA-F]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)|(' + word + ')', 'g');
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      let cls = '';
      if (m[1]) cls = 'tk-c';
      else if (m[2]) cls = cfg.keys && /^\s*:/.test(code.slice(re.lastIndex, re.lastIndex + 40)) ? 'tk-key' : 'tk-s';
      else if (m[3]) cls = 'tk-n';
      else if (m[4] && cfg.kw.has(cfg.ci ? m[4].toLowerCase() : m[4])) cls = 'tk-k';
      out += cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0]);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }
  return run;
})();

const Md = (() => {
  const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
  const wsLen = (s) => s.replace(/\t/g, '    ').length;

  function safeHref(raw) { return /^(https?:|mailto:)/i.test(raw) ? raw : null; }

  function inline(src) {
    const stash = [];
    const hold = (html) => { stash.push(html); return '\u0001' + (stash.length - 1) + '\u0001'; };
    // code spans first so their content is never touched by other rules
    src = src.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, c) => hold('<code>' + esc(c.replace(/^ (.*) $/, '$1')) + '</code>'));
    let s = esc(src);
    // [text](url)
    s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, text, url) => {
      const raw = url.replace(/&amp;/g, '&');
      return safeHref(raw) ? hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`) : m;
    });
    // bare URLs
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)&])/g, (m, pre, url) => pre + hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
    s = s.replace(/\*\*([^\s*](?:[^*]*[^\s*])?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w])__([^\s_](?:[^_]*[^\s_])?)__(?=$|[^\w])/g, '$1<strong>$2</strong>');
    s = s.replace(/(^|[^*])\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_([^\s_](?:[^_]*[^\s_])?)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');
    s = s.replace(/~~([^\s~](?:[^~]*[^\s~])?)~~/g, '<del>$1</del>');
    s = s.replace(/( {2,}|\\)\n/g, '<br>').replace(/\n/g, ' ');
    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => stash[+i]);
  }

  function codeBlock(code, lang) {
    const label = lang ? esc(lang) : 'text';
    return `<div class="code"><div class="code-head"><span>${label}</span><button type="button" class="link" data-copy-code>Copy</button></div><pre><code>${Highlight(code, lang)}</code></pre></div>`;
  }

  function isBlockStart(line) {
    return FENCE.test(line) || /^\s{0,3}#{1,6}\s/.test(line) || HR.test(line) || /^\s{0,3}>/.test(line) || ITEM.test(line);
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
      else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; }
      else cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }

  function table(lines, i) {
    const head = splitRow(lines[i]);
    const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'ta-c' : /^-+:$/.test(c) ? 'ta-r' : ''));
    let j = i + 2;
    const rows = [];
    while (j < lines.length && lines[j].trim() && lines[j].includes('|')) { rows.push(splitRow(lines[j])); j++; }
    const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` class="${aligns[k]}"` : ''}>${inline(c)}</${tag}>`;
    const html = '<div class="table-wrap"><table><thead><tr>' + head.map((c, k) => cell('th', c, k)).join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + head.map((_, k) => cell('td', r[k] || '', k)).join('') + '</tr>').join('') + '</tbody></table></div>';
    return { html, next: j };
  }

  function list(lines, start) {
    const first = ITEM.exec(lines[start]);
    const base = wsLen(first[1]);
    const ordered = /^\d/.test(first[2]);
    const startNum = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let loose = false, i = start;
    while (i < lines.length) {
      const m = ITEM.exec(lines[i]);
      if (!m || HR.test(lines[i])) break;
      const ind = wsLen(m[1]);
      if (ind < base || (ind === base && /^\d/.test(m[2]) !== ordered)) break;
      const contentIndent = ind + m[2].length + 1;
      const body = [m[3]];
      let hasBlank = false;
      i++;
      while (i < lines.length) {
        const ln = lines[i].replace(/\t/g, '    ');
        if (!ln.trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length) {
            const nl = lines[j].replace(/\t/g, '    ');
            const nInd = wsLen(/^\s*/.exec(nl)[0]);
            if (nInd > ind) { for (let k = i; k < j; k++) body.push(''); hasBlank = true; i = j; continue; }
          }
          break;
        }
        const lInd = wsLen(/^\s*/.exec(ln)[0]);
        const lm = ITEM.exec(ln);
        if (lm && lInd <= ind) break;
        if (lInd > ind) { body.push(ln.replace(new RegExp('^ {0,' + Math.min(lInd, contentIndent) + '}'), '')); i++; continue; }
        if (body[body.length - 1] !== '' && !isBlockStart(ln)) { body.push(ln.trim()); i++; continue; }
        break;
      }
      items.push({ body, hasBlank });
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j > i && j < lines.length) {
        const nm = ITEM.exec(lines[j]);
        if (nm && !HR.test(lines[j]) && wsLen(nm[1]) === base && /^\d/.test(nm[2]) === ordered) { loose = true; i = j; }
      }
    }
    const tag = ordered ? 'ol' : 'ul';
    const attr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
    const html = `<${tag}${attr}>` + items.map((it) => {
      let inner = blocks(it.body);
      if (!loose && !it.hasBlank) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      return '<li>' + inner + '</li>';
    }).join('') + `</${tag}>`;
    return { html, next: i };
  }

  function blocks(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m = FENCE.exec(line);
      if (m) {
        const ch = m[1][0], len = m[1].length, lang = m[2], buf = [];
        const close = new RegExp('^\\s{0,3}' + (ch === '`' ? '`' : '~') + '{' + len + ',}\\s*$');
        i++;
        while (i < lines.length && !close.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(codeBlock(buf.join('\n'), lang));
        continue;
      }
      m = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
      if (m) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
      if (HR.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s{0,3}>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { buf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
        out.push('<blockquote>' + blocks(buf) + '</blockquote>');
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const t = table(lines, i);
        out.push(t.html); i = t.next; continue;
      }
      if (ITEM.test(line)) { const r = list(lines, i); out.push(r.html); i = r.next; continue; }
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
      out.push('<p>' + inline(buf.join('\n')) + '</p>');
    }
    return out.join('');
  }

  return { render: (src) => blocks(String(src).replace(/\r\n?/g, '\n').split('\n')) };
})();

/* ============================================================
   3. Model capabilities
   OpenAI's /v1/models returns only id, created and owned_by — no capability data.
   The rules below are inferred from the model name and the published model docs.
   They only decide which controls are enabled; "Ignore inferred limits" bypasses them.
   ============================================================ */
function getCaps(rawId) {
  const id = String(rawId).toLowerCase();
  const none = { web: false, files: false, code: false, image: false };
  const all = { web: true, files: true, code: true, image: true };
  const caps = { family: 'unknown', known: false, reasoning: false, efforts: [], modePro: false, sampling: true, vision: null, tools: { ...none }, maxOutput: null };
  let m;

  if ((m = /^gpt-5(?:\.(\d+))?(?=$|-)/.exec(id))) {
    const minor = m[1] ? +m[1] : 0;
    const pro = /-pro(?=$|-)/.test(id);
    Object.assign(caps, { family: minor ? 'gpt-5.' + minor : 'gpt-5', known: true, reasoning: true, vision: true, tools: { ...all } });
    if (minor === 0) {
      caps.efforts = ['minimal', 'low', 'medium', 'high'];
      if (/codex/.test(id)) caps.efforts = ['low', 'medium', 'high'];
      if (pro) caps.efforts = ['high'];
    } else if (minor === 1) {
      caps.efforts = ['none', 'low', 'medium', 'high'];
      if (/codex-max/.test(id)) caps.efforts.push('xhigh');
    } else if (minor <= 5) {
      caps.efforts = ['none', 'low', 'medium', 'high', 'xhigh'];
    } else {
      caps.efforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
      caps.modePro = true;
    }
    if (pro && minor >= 2) caps.efforts = caps.efforts.filter((e) => e !== 'none' && e !== 'low');
    caps.sampling = minor >= 1 && minor <= 5 && !pro ? 'effort-none' : false;
    if (/nano/.test(id)) caps.tools.image = false;
  } else if (/^gpt-6/.test(id)) {
    Object.assign(caps, { family: 'gpt-6', known: true, reasoning: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], sampling: false, vision: true, tools: { ...all }, maxOutput: /astra/.test(id) ? 128000 : null });
  } else if (/^o\d/.test(id)) {
    const legacy = /^o1-(mini|preview)/.test(id);
    Object.assign(caps, { family: 'o-series', known: true, reasoning: !legacy, efforts: legacy ? [] : ['low', 'medium', 'high'], sampling: false, vision: !/^o1-(mini|preview)|^o3-mini/.test(id), tools: /^o1|^o3-mini/.test(id) ? { ...none } : { ...all } });
  } else if (/^(gpt-4o|chatgpt-4o|gpt-4\.1|gpt-4\.5)/.test(id)) {
    Object.assign(caps, { family: 'gpt-4o/4.1', known: true, sampling: true, vision: true, tools: { ...all } });
    if (/^chatgpt-4o/.test(id) || /audio|realtime|search-preview|transcribe|tts/.test(id)) caps.tools = { ...none };
    if (/4\.1-nano/.test(id)) { caps.tools.web = false; caps.tools.image = false; }
  } else if (/^gpt-4-turbo/.test(id)) {
    Object.assign(caps, { family: 'gpt-4-turbo', known: true, vision: !/preview/.test(id) });
  } else if (/^gpt-4($|-)/.test(id)) {
    Object.assign(caps, { family: 'gpt-4', known: true, vision: /vision/.test(id) });
  } else if (/^gpt-3\.5/.test(id)) {
    Object.assign(caps, { family: 'gpt-3.5', known: true, vision: false });
  }
  return caps;
}

function describeCaps(c, override) {
  if (override) return 'Inferred limits are ignored: every control is enabled and sent as configured. The API decides what is valid.';
  if (!c.known) return 'Unknown model family. Reasoning and hosted tools are disabled because their support cannot be inferred. Use "Ignore inferred limits" to send them anyway.';
  const bits = [];
  bits.push(c.reasoning ? `reasoning: ${c.efforts.map((e) => EFFORT_LABELS[e]).join(', ')}` : 'reasoning: not supported');
  bits.push(c.sampling === true ? 'temperature / top_p: supported' : c.sampling === 'effort-none' ? 'temperature / top_p: only with reasoning None' : 'temperature / top_p: not supported');
  bits.push(c.vision === true ? 'image input: yes' : c.vision === false ? 'image input: no' : 'image input: unknown');
  const tools = Object.entries({ 'web search': c.tools.web, 'file search': c.tools.files, 'code interpreter': c.tools.code, 'image generation': c.tools.image }).filter(([, v]) => v).map(([k]) => k);
  bits.push('tools: ' + (tools.length ? tools.join(', ') : 'none'));
  return 'Inferred from the model name (the model list carries no capability data). ' + bits.join(' · ') + '.';
}

const isTextModel = (id) => /^(gpt-|o\d|chatgpt-|codex-)/.test(id) &&
  !/(embedding|whisper|tts|dall-e|gpt-image|moderation|realtime|audio|transcribe|diarize|sora|davinci|babbage|computer-use|-live)/.test(id);

/* ============================================================
   4. API layer
   ============================================================ */
class ApiError extends Error {
  constructor(o) { super(o.message); Object.assign(this, o); }
}

function hintFor(e) {
  if (e.kind === 'network') return 'The browser could not complete the request to api.openai.com. Check your connection, VPN or firewall, and extensions that block requests. Browsers report CORS failures the same way.';
  if (e.kind === 'local') return '';
  const s = e.status, code = e.code || '';
  if (s === 401) return 'The API key was rejected. Check that it is complete, active, and belongs to the right project.';
  if (s === 403) return code === 'unsupported_country_region_territory' ? 'OpenAI does not serve requests from this region.' : 'The key or project does not have access. Common causes: model permissions, organization verification, or region.';
  if (s === 404) return code === 'model_not_found' ? 'This model is not available to your project. Pick another model or check project permissions.' : 'The requested resource was not found.';
  if (s === 400 || s === 422) return e.param || /unsupported/i.test(code) ? `The parameter "${e.param || 'unknown'}" is not accepted here. Turn it off in the panel — or keep it to reproduce the error.` : 'The request is invalid. Compare the Request tab with the API reference.';
  if (s === 413) return 'The request is too large. Reduce the attachment size or the prompt.';
  if (s === 429) return code === 'insufficient_quota' ? 'The account has no remaining quota. Check billing and usage limits.' : 'Rate limit reached. Wait and retry, or lower the request size.';
  if (s >= 500) return 'OpenAI-side error. Retry in a moment; quote the request ID if you contact support.';
  return '';
}

function toApiError(res, text, data) {
  const err = data && data.error && typeof data.error === 'object' ? data.error : null;
  const message = (err && err.message) || (text ? text.slice(0, 600) : `${res.status} ${res.statusText}`);
  return new ApiError({
    kind: 'http', status: res.status, statusText: res.statusText, message,
    type: err && err.type, code: err && err.code, param: err && err.param,
    requestId: res.headers.get('x-request-id') || (message.match(/req_[A-Za-z0-9]+/) || [])[0] || null,
    raw: text,
  });
}

function networkError(e) {
  return new ApiError({ kind: 'network', message: `Network error: ${e && e.message ? e.message : e}` });
}

/* Every call goes through here. The key is added to the real request only — never to anything displayed. */
async function api(method, path, { json, form, signal } = {}) {
  const headers = { Authorization: 'Bearer ' + state.key };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form;
  let res;
  try { res = await fetch(API_BASE + path, { method, headers, body, signal }); }
  catch (e) { if (e && e.name === 'AbortError') throw e; throw networkError(e); }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* non-JSON body */ }
  if (!res.ok) throw toApiError(res, text, data);
  return { res, text, data };
}

/* ============================================================
   5. State + connection
   ============================================================ */
const state = {
  key: '', ready: false, models: [], caps: null,
  attachments: [], uploaded: [],               // uploaded = documents sent to the Files API this session
  turns: [], selected: null, busy: false, abort: null,
  inspectorMode: 'preview', showProblems: false,
  lastRequest: null, lastError: null,
  vectorStores: [], vsFiles: [],
};

function setStatus(el, kind, text) { el.className = 'status ' + kind; el.textContent = text; }

function setLocked(locked) {
  $('workspace').disabled = locked;
  for (const id of ['prompt', 'add-images', 'add-docs']) $(id).disabled = locked;
  refreshRunButton();
  refreshUploadButton();
}

async function init() {
  const key = $('api-key').value.trim();
  const status = $('init-status');
  if (!key) { setStatus(status, 'err', 'Enter an API key.'); return; }
  if (!/^[\x21-\x7e]+$/.test(key)) { setStatus(status, 'err', 'The key contains spaces or non-ASCII characters. Re-paste it.'); return; }
  state.key = key;
  $('init').disabled = true;
  setStatus(status, 'busy', 'Connecting…');
  try {
    const { data } = await api('GET', '/models');
    state.models = (data.data || []).map((m) => ({ id: m.id, created: m.created || 0, owned_by: m.owned_by }))
      .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
    state.ready = true;
    setLocked(false);
    renderModels();
    populateImageModels();
    setStatus(status, 'ok', `Connected · ${state.models.length} models loaded from /v1/models`);
    $('init').textContent = 'Re-init';
    applyCaps();
    if (window.matchMedia('(max-width: 900px)').matches) closePanel();
    loadVectorStores();
  } catch (e) {
    state.ready = false; state.key = '';
    setLocked(true);
    const ex = e instanceof ApiError ? e : networkError(e);
    setStatus(status, 'err', `INIT failed — ${errorLine(ex)}`);
    reportError('INIT', ex);
  } finally {
    $('init').disabled = false;
  }
}

function errorLine(e) {
  if (e.kind === 'network') return e.message;
  return `HTTP ${e.status}${e.code ? ' · ' + e.code : ''}: ${e.message}`;
}

/* ============================================================
   6. Models + capability-driven UI
   ============================================================ */
function renderModels() {
  const q = $('model-search').value.trim().toLowerCase();
  const showAll = $('show-all-models').checked;
  const sel = $('model');
  const current = sel.value;
  const list = state.models.filter((m) => (showAll || isTextModel(m.id)) && (!q || m.id.toLowerCase().includes(q)));
  sel.innerHTML = '<option value="">— choose a model —</option>';
  const ids = new Set();
  for (const m of list) { sel.add(new Option(m.id, m.id)); ids.add(m.id); }
  if (current && !ids.has(current)) sel.add(new Option(current, current), 1); // never drop the user's selection because of a filter
  sel.value = current || '';
  $('model-count').textContent = `${list.length} shown · ${state.models.length} total`;
}

function populateImageModels() {
  $('img-model-list').innerHTML = state.models.filter((m) => /image/.test(m.id) && /gpt-image|chatgpt-image/.test(m.id)).map((m) => `<option value="${esc(m.id)}">`).join('');
}

function setOptions(select, pairs, keep) {
  const cur = keep ? select.value : '';
  select.innerHTML = '';
  for (const [v, t] of pairs) select.add(new Option(t, v));
  select.value = pairs.some(([v]) => v === cur) ? cur : '';
}

function samplingState(c, effort, override) {
  if (override) return { ok: true };
  if (!c) return { ok: false, why: 'Choose a model first.' };
  if (c.sampling === true) return { ok: true };
  if (c.sampling === 'effort-none') return effort === 'none' ? { ok: true } : { ok: false, why: 'this model only accepts it when reasoning effort is None.' };
  return { ok: false, why: 'this model does not support it (reasoning models reject custom sampling values).' };
}

function applyCaps() {
  const id = $('model').value;
  const override = $('cap-override').checked;
  const c = id ? getCaps(id) : null;
  state.caps = c;
  const has = !!id;

  // reasoning
  const efforts = !has ? [] : override ? ALL_EFFORTS : c.efforts;
  const rOK = has && (override || c.reasoning);
  setOptions($('reasoning'), [['', 'Default (not sent)'], ...efforts.map((e) => [e, EFFORT_LABELS[e]])], true);
  $('reasoning').disabled = !rOK;
  $('reasoning-summary').disabled = !rOK;
  $('reasoning-mode-wrap').hidden = !(has && (override || (c && c.modePro)));
  $('reasoning-mode').disabled = !rOK;
  $('reasoning-hint').textContent = !has ? 'Choose a model first.'
    : !rOK ? 'This model does not accept reasoning settings, so none are sent.'
    : override ? 'All documented effort values are listed. Unsupported ones will be rejected by the API.'
    : `Values this model accepts: ${efforts.map((e) => EFFORT_LABELS[e]).join(', ')}. "Default" sends nothing and lets the model choose.`;

  // sampling
  const s = samplingState(c, $('reasoning').value, override);
  for (const base of ['temperature', 'top-p']) {
    $(base).disabled = !s.ok; $(base + '-num').disabled = !s.ok; $(base + '-clear').disabled = !s.ok;
  }
  updateSamplingHints(s);

  // max output
  const maxOut = c && c.maxOutput ? ` Model maximum: ${fmtNum(c.maxOutput)}.` : '';
  const room = rOK && !override ? ' Reasoning tokens count against this limit; OpenAI suggests leaving generous room (25,000+) when experimenting.' : '';
  $('max-output-hint').textContent = 'Maximum number of tokens the model may generate. Empty means not sent.' + maxOut + room;

  // tools
  for (const [key, cid] of [['web', 'tool-web'], ['files', 'tool-files'], ['code', 'tool-code'], ['image', 'tool-image']]) {
    const ok = has && (override || c.tools[key]);
    const box = $(cid);
    box.disabled = !ok;
    if (!ok) box.checked = false;
    const why = document.querySelector(`[data-why="${key}"]`);
    why.hidden = ok || !has;
    why.textContent = 'Not available for this model (inferred from its name).';
  }
  syncToolPanels();
  $('capability-note').textContent = has ? describeCaps(c, override) : 'Choose a model to see which options it accepts.';
  if (!state.turns.some((t) => t.response)) updateStats();
}

function updateSamplingHints(s) {
  s = s || samplingState(state.caps, $('reasoning').value, $('cap-override').checked);
  const t = $('temperature-num').value, p = $('top-p-num').value;
  $('temperature-hint').textContent = s.ok
    ? 'Higher values generally make output more random; lower values make it more focused.' + (t === '' ? ' Currently not sent.' : '')
    : 'Unavailable: ' + s.why;
  $('top-p-hint').textContent = s.ok
    ? 'Nucleus sampling. Controls the probability mass considered during token selection.' + (p === '' ? ' Currently not sent.' : '')
    : 'Unavailable: ' + s.why;
}

function syncToolPanels() {
  $('web-opts').hidden = !$('tool-web').checked;
  $('files-opts').hidden = !$('tool-files').checked;
  $('image-opts').hidden = !$('tool-image').checked;
  const fmt = $('img-format').value;
  const comp = $('img-compression');
  comp.disabled = !(fmt === 'jpeg' || fmt === 'webp');
  if (comp.disabled) comp.value = '';
}

function bindSlider(base) {
  const range = $(base), num = $(base + '-num');
  range.addEventListener('input', () => { num.value = range.value; updateSamplingHints(); });
  num.addEventListener('input', () => { if (num.value !== '' && !isNaN(+num.value)) range.value = num.value; updateSamplingHints(); });
  $(base + '-clear').addEventListener('click', () => { num.value = ''; updateSamplingHints(); onControlChange(); });
}

/* ============================================================
   7. Request builder — the single source of truth for what is sent
   ============================================================ */
function numOrNull(v) { if (v === '' || v == null) return null; const n = Number(v); return isFinite(n) ? n : NaN; }

function buildRequest() {
  const problems = [], warnings = [];
  const override = $('cap-override').checked;
  const c = state.caps;
  const model = $('model').value;
  const body = { model };
  if (!model) problems.push('Choose a model.');

  const instructions = $('instructions').value.trim();
  if (instructions) body.instructions = instructions;

  // input
  const text = $('prompt').value.trim();
  const parts = [];
  if (text) parts.push({ type: 'input_text', text });
  const images = state.attachments.filter((a) => a.kind === 'image');
  for (const a of state.attachments) {
    if (a.kind === 'image') parts.push({ type: 'input_image', image_url: a.dataUrl });
    else if (a.status === 'ready') parts.push({ type: 'input_file', file_id: a.fileId });
  }
  if (!parts.length) problems.push('Enter a prompt or attach a file.');
  body.input = parts.length === 1 && parts[0].type === 'input_text' ? text : [{ role: 'user', content: parts }];
  if (images.length && c && c.vision === false && !override) {
    problems.push(`${model} cannot process images (no vision input). Choose a vision-capable model or remove the image.`);
  }
  if (state.attachments.some((a) => a.kind === 'doc' && a.status === 'uploading')) problems.push('A file is still uploading.');
  if (state.attachments.some((a) => a.kind === 'doc' && a.status === 'error')) problems.push('Remove the attachment that failed to upload.');

  // reasoning
  if (!$('reasoning').disabled) {
    const r = {};
    if ($('reasoning').value) r.effort = $('reasoning').value;
    if ($('reasoning-summary').value) r.summary = $('reasoning-summary').value;
    if (!$('reasoning-mode-wrap').hidden && $('reasoning-mode').value) r.mode = $('reasoning-mode').value;
    if (Object.keys(r).length) body.reasoning = r;
  }

  // generation parameters
  const maxOut = numOrNull($('max-output').value);
  if (maxOut !== null) {
    if (isNaN(maxOut) || maxOut < 16 || !Number.isInteger(maxOut)) problems.push('Max output tokens must be a whole number of at least 16.');
    else body.max_output_tokens = maxOut;
  }
  let sentTemp = false, sentTopP = false;
  if (!$('temperature-num').disabled) {
    const t = numOrNull($('temperature-num').value);
    if (t !== null) { if (isNaN(t) || t < 0 || t > 2) problems.push('Temperature must be between 0 and 2.'); else { body.temperature = t; sentTemp = true; } }
  }
  if (!$('top-p-num').disabled) {
    const p = numOrNull($('top-p-num').value);
    if (p !== null) { if (isNaN(p) || p < 0 || p > 1) problems.push('Top P must be between 0 and 1.'); else { body.top_p = p; sentTopP = true; } }
  }
  if (sentTemp && sentTopP) warnings.push('Both Temperature and Top P are set. OpenAI recommends adjusting one of them.');

  // tools
  const tools = [], include = [];
  if ($('tool-web').checked && !$('tool-web').disabled) {
    const t = { type: 'web_search' };
    if ($('web-context').value) t.search_context_size = $('web-context').value;
    const loc = {};
    const country = $('web-country').value.trim().toUpperCase(), city = $('web-city').value.trim(), region = $('web-region').value.trim();
    if (country) { if (/^[A-Z]{2}$/.test(country)) loc.country = country; else problems.push('Web search country must be a 2-letter code.'); }
    if (city) loc.city = city;
    if (region) loc.region = region;
    if (Object.keys(loc).length) t.user_location = { type: 'approximate', ...loc };
    const domains = $('web-domains').value.split(',').map((d) => d.trim().replace(/^https?:\/\//, '')).filter(Boolean);
    if (domains.length) t.filters = { allowed_domains: domains };
    tools.push(t);
    include.push('web_search_call.action.sources');
    if (body.reasoning && body.reasoning.effort === 'minimal' && !override) warnings.push('Web search is not supported with Minimal reasoning on GPT-5 models.');
  }
  if ($('tool-files').checked && !$('tool-files').disabled) {
    const vs = $('vs-select').value;
    if (!vs) problems.push('File search needs a vector store — select one under Knowledge base.');
    const t = { type: 'file_search', vector_store_ids: vs ? [vs] : [] };
    const mx = numOrNull($('fs-max').value);
    if (mx !== null) { if (isNaN(mx) || mx < 1 || mx > 50 || !Number.isInteger(mx)) problems.push('File search max results must be 1–50.'); else t.max_num_results = mx; }
    tools.push(t);
    if ($('fs-results').checked) include.push('file_search_call.results');
  }
  if ($('tool-code').checked && !$('tool-code').disabled) {
    tools.push({ type: 'code_interpreter', container: { type: 'auto' } });
    include.push('code_interpreter_call.outputs');
  }
  if ($('tool-image').checked && !$('tool-image').disabled) {
    const t = { type: 'image_generation' };
    for (const [field, id] of [['model', 'img-model'], ['size', 'img-size'], ['quality', 'img-quality'], ['output_format', 'img-format'], ['background', 'img-background'], ['moderation', 'img-moderation']]) {
      const v = $(id).value.trim();
      if (v) t[field] = v;
    }
    const comp = numOrNull($('img-compression').value);
    if (comp !== null && !$('img-compression').disabled) { if (isNaN(comp) || comp < 0 || comp > 100) problems.push('Image compression must be 0–100.'); else t.output_compression = comp; }
    tools.push(t);
    if ($('img-force').checked) body.tool_choice = { type: 'image_generation' };
  }
  if (tools.length) body.tools = tools;
  if (include.length) body.include = include;

  // key order stays stable for readability
  const order = ['model', 'instructions', 'input', 'reasoning', 'max_output_tokens', 'temperature', 'top_p', 'tools', 'tool_choice', 'include'];
  const ordered = {};
  for (const k of order) if (k in body) ordered[k] = body[k];

  return { method: 'POST', url: RESPONSES_URL, headers: { Authorization: 'Bearer ********', 'Content-Type': 'application/json' }, body: ordered, problems, warnings };
}

function metaText(req) {
  return `${req.method} ${req.url}\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
}
function curlText(req) {
  const json = JSON.stringify(req.body, null, 2).replace(/'/g, "'\\''");
  return `curl ${req.url} \\\n  -H "Authorization: Bearer $OPENAI_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${json}'`;
}

/* ============================================================
   8. Inspector
   ============================================================ */
function setTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const p of document.querySelectorAll('.pane')) p.hidden = p.dataset.pane !== name;
  if (name === 'errors') $('err-badge').hidden = true;
  setInspectorOpen(true);
}
function setInspectorOpen(open) {
  $('inspector-body').hidden = !open;
  const b = $('inspector-toggle');
  b.setAttribute('aria-expanded', String(open));
  b.textContent = open ? '▾' : '▴';
  b.setAttribute('aria-label', open ? 'Collapse inspector' : 'Expand inspector');
}

function renderRequestPane(req, label) {
  $('inspector-label').textContent = label;
  $('request-meta').textContent = metaText(req);
  $('request-json').innerHTML = Highlight(JSON.stringify(shorten(req.body), null, 2), 'json');
  state.lastRequest = req;
  const box = $('request-problems');
  box.innerHTML = '';
  if (state.inspectorMode === 'preview') {
    const shown = req.problems.filter((p) => state.showProblems || p.startsWith('File search') || /cannot process images/.test(p));
    if (shown.length) box.appendChild(noticeList('err', 'This request cannot be sent yet:', shown));
    if (req.warnings.length) box.appendChild(noticeList('warn', 'Heads up:', req.warnings));
  }
}

function noticeList(kind, title, items) {
  const d = document.createElement('div');
  d.className = 'notice ' + kind;
  d.innerHTML = `<strong>${esc(title)}</strong><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  return d;
}

function renderPreview() {
  if (state.inspectorMode !== 'preview') return;
  if (!state.ready) {
    $('inspector-label').textContent = 'Preview';
    $('request-meta').textContent = `POST ${RESPONSES_URL}`;
    $('request-json').textContent = 'Initialize with an API key to see the request this app would send.';
    $('request-problems').innerHTML = '';
    renderComposerNote(null);
    return;
  }
  const req = buildRequest();
  renderRequestPane(req, 'Preview — what Run would send now');
  renderComposerNote(req);
}

function renderComposerNote(req) {
  const box = $('composer-note');
  box.innerHTML = '';
  if (!req) return;
  const problems = req.problems.filter((p) => state.showProblems || /cannot process images/.test(p));
  if (problems.length) box.appendChild(noticeList('err', 'Not sent:', problems));
  if (req.warnings.length) box.appendChild(noticeList('warn', 'Heads up:', req.warnings));
}

function showTurnInspector(turn) {
  state.selected = turn.n;
  state.inspectorMode = 'turn';
  renderRequestPane(turn.request, `Sent request · turn ${turn.n}`);
  // response
  if (turn.response) {
    $('response-meta').textContent = `HTTP ${turn.response.status} · ${turn.response.ms} ms\n` + (turn.response.headers.length ? turn.response.headers.join('\n') : '(no response headers exposed to the browser)');
    $('response-json').innerHTML = Highlight(JSON.stringify(shorten(turn.response.data), null, 2), 'json');
    fillUsage(turn.response.data);
  } else {
    $('response-meta').textContent = turn.error ? `No response body — request ended with an error.` : 'Waiting for response…';
    $('response-json').textContent = turn.error ? 'See the Errors tab.' : '';
    fillUsage(null);
  }
  if (turn.error) fillError(turn.error, `Run · turn ${turn.n}`);
}

function fillUsage(data) {
  const dl = $('usage-detail');
  const usage = data && data.usage;
  if (!usage) { dl.innerHTML = '<dt>Status</dt><dd>No usage returned.</dd>'; $('usage-json').textContent = ''; return; }
  const rows = flatten(usage);
  dl.innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('usage-json').innerHTML = Highlight(JSON.stringify(usage, null, 2), 'json');
}

function reportError(source, err) {
  state.lastError = { source, err, at: stamp() };
  fillError(err, source);
  $('err-badge').hidden = false;
}

function fillError(err, source) {
  const box = $('error-view');
  const title = err.kind === 'network' ? 'Network error' : err.kind === 'local' ? 'Not sent' : `HTTP ${err.status}${err.statusText ? ' ' + err.statusText : ''}`;
  const rows = [['Source', source], ['HTTP status', err.status != null ? String(err.status) : '—'], ['Error type', err.type || '—'], ['Error code', err.code || '—'], ['Parameter', err.param || '—'], ['Message', err.message], ['Request ID', err.requestId || 'not available (not exposed to the browser or not returned)']];
  const hint = hintFor(err);
  box.innerHTML = `<p class="err-title">${esc(title)}</p><dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` +
    (hint ? `<p class="hint">${esc(hint)}</p>` : '') +
    (err.raw ? `<pre class="pre">${esc(prettyRaw(err.raw))}</pre>` : '');
}
function prettyRaw(raw) { try { return JSON.stringify(JSON.parse(raw), null, 2); } catch (_) { return raw; } }

function updateStats(data, model) {
  const set = (k, v) => { document.querySelector(`[data-stat="${k}"]`).textContent = v; };
  const u = data && data.usage;
  set('model', (data && data.model) || model || $('model').value || '—');
  set('input', u ? fmtNum(u.input_tokens) : '—');
  set('output', u ? fmtNum(u.output_tokens) : '—');
  set('total', u ? fmtNum(u.total_tokens) : '—');
  const extra = [];
  if (u && u.output_tokens_details && typeof u.output_tokens_details.reasoning_tokens === 'number') extra.push(`${fmtNum(u.output_tokens_details.reasoning_tokens)} reasoning`);
  if (u && u.input_tokens_details && typeof u.input_tokens_details.cached_tokens === 'number' && u.input_tokens_details.cached_tokens > 0) extra.push(`${fmtNum(u.input_tokens_details.cached_tokens)} cached`);
  $('usage-extra').textContent = extra.join(' · ');
}

/* ============================================================
   9. Attachments (images inline; documents uploaded to the Files API)
   ============================================================ */
function refreshRunButton() {
  const run = $('run');
  run.textContent = state.busy ? 'Stop' : 'Run';
  run.disabled = !state.ready;
}
function refreshUploadButton() {
  const n = state.uploaded.length;
  $('delete-uploads').disabled = !state.ready || n === 0 || state.busy;
  $('delete-uploads').textContent = n ? `Delete uploads (${n})` : 'Delete uploads';
}

function renderAttachments(note, silent) {
  const box = $('attachments');
  box.innerHTML = '';
  for (const a of state.attachments) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (a.status === 'error' ? ' err' : '');
    if (a.kind === 'image') { const im = document.createElement('img'); im.className = 'chip-thumb'; im.alt = ''; im.src = a.dataUrl; chip.appendChild(im); }
    const name = document.createElement('span'); name.className = 'chip-name'; name.textContent = a.name; name.title = a.name; chip.appendChild(name);
    const meta = document.createElement('span'); meta.className = 'muted';
    meta.textContent = a.kind === 'image' ? fmtBytes(a.size) : a.status === 'uploading' ? 'uploading…' : a.status === 'error' ? 'failed' : a.fileId;
    chip.appendChild(meta);
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.dataset.remove = a.id; x.setAttribute('aria-label', 'Remove ' + a.name);
    chip.appendChild(x);
    box.appendChild(chip);
  }
  const imgs = state.attachments.filter((a) => a.kind === 'image').length;
  const docs = state.attachments.filter((a) => a.kind === 'doc').length;
  const parts = [];
  if (imgs) parts.push(`${imgs} image${imgs > 1 ? 's' : ''} (sent inline)`);
  if (docs) parts.push(`${docs} file${docs > 1 ? 's' : ''} (uploaded to OpenAI)`);
  $('attach-status').textContent = note || parts.join(' · ');
  refreshUploadButton();
  if (!silent) onControlChange();
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function addImages(files) {
  const rejected = [];
  for (const f of files) {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) { rejected.push(`${f.name}: unsupported type (use PNG, JPEG, WebP or GIF)`); continue; }
    if (f.size > MAX_IMAGE_BYTES) { rejected.push(`${f.name}: larger than ${fmtBytes(MAX_IMAGE_BYTES)}`); continue; }
    try { state.attachments.push({ id: uid(), kind: 'image', name: f.name, size: f.size, dataUrl: await readAsDataUrl(f) }); }
    catch (e) { rejected.push(`${f.name}: could not be read`); }
  }
  renderAttachments(rejected.length ? 'Not added — ' + rejected.join('; ') : '');
}

async function addDocs(files) {
  for (const f of files) {
    const att = { id: uid(), kind: 'doc', name: f.name, size: f.size, status: 'uploading' };
    state.attachments.push(att);
    renderAttachments();
    try {
      const form = new FormData();
      form.append('purpose', 'user_data');
      form.append('file', f, f.name);
      const { data } = await api('POST', '/files', { form });
      att.fileId = data.id; att.status = 'ready';
      state.uploaded.push({ id: data.id, name: f.name });
    } catch (e) {
      const ex = e instanceof ApiError ? e : networkError(e);
      att.status = 'error';
      reportError('File upload', ex);
      renderAttachments(`Upload failed for ${f.name} — ${errorLine(ex)}`);
      continue;
    }
    renderAttachments();
  }
}

async function removeAttachment(id) {
  const i = state.attachments.findIndex((a) => a.id === id);
  if (i < 0) return;
  const [att] = state.attachments.splice(i, 1);
  renderAttachments();
  if (att.kind === 'doc' && att.fileId) await deleteRemoteFiles([att.fileId], true);
}

async function deleteRemoteFiles(ids, quiet) {
  let ok = 0; const failed = [];
  for (const fid of ids) {
    try { await api('DELETE', '/files/' + fid); ok++; state.uploaded = state.uploaded.filter((u) => u.id !== fid); state.attachments = state.attachments.filter((a) => a.fileId !== fid); }
    catch (e) { const ex = e instanceof ApiError ? e : networkError(e); failed.push(`${fid}: ${errorLine(ex)}`); reportError('Delete upload', ex); }
  }
  renderAttachments(failed.length ? `Deleted ${ok}, failed ${failed.length} — ${failed.join('; ')}` : quiet ? '' : `Deleted ${ok} uploaded file${ok === 1 ? '' : 's'} from OpenAI.`);
}

/* ============================================================
   10. Run + rendering
   ============================================================ */
function scrollChat(force) {
  const sc = $('chat-scroll');
  if (force || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160) sc.scrollTop = sc.scrollHeight;
}

function addTurn(req, attachments) {
  $('empty-state')?.remove();
  const n = state.turns.length + 1;
  const turn = { n, request: req, response: null, error: null };
  const el = document.createElement('article');
  el.className = 'turn';
  const user = document.createElement('div'); user.className = 'msg user';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const prompt = typeof req.body.input === 'string' ? req.body.input : ((req.body.input[0].content.find((p) => p.type === 'input_text') || {}).text || '');
  bubble.textContent = prompt;
  if (attachments.length) {
    const chips = document.createElement('div'); chips.className = 'chips';
    for (const a of attachments) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = (a.kind === 'image' ? 'image · ' : 'file · ') + a.name; chips.appendChild(c); }
    bubble.appendChild(chips);
  }
  user.appendChild(bubble);
  const asst = document.createElement('div'); asst.className = 'msg assistant';
  const body = document.createElement('div'); body.className = 'assistant-body md';
  const pend = document.createElement('div'); pend.className = 'pending'; pend.textContent = 'Waiting for response…';
  body.appendChild(pend);
  const meta = document.createElement('div'); meta.className = 'turn-meta';
  asst.append(body, meta);
  el.append(user, asst);
  $('response').appendChild(el);
  turn.el = el; turn.body = body; turn.metaEl = meta; turn.pendEl = pend;
  state.turns.push(turn);
  scrollChat(true);
  return turn;
}

function metaLinks(turn, statusText) {
  const m = turn.metaEl;
  m.innerHTML = '';
  const s = document.createElement('span'); s.textContent = statusText; m.appendChild(s);
  const ins = document.createElement('button'); ins.type = 'button'; ins.className = 'link'; ins.textContent = 'Inspect'; ins.dataset.inspect = turn.n; m.appendChild(ins);
  if (turn.response) {
    const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'link'; cp.textContent = 'Copy answer'; cp.dataset.copyAnswer = turn.n; m.appendChild(cp);
  }
}

function textOf(data) {
  const out = [];
  for (const it of data.output || []) if (it.type === 'message') for (const c of it.content || []) if (c.type === 'output_text') out.push(c.text);
  return out.join('\n\n');
}

function toolCall(title, obj) {
  const d = document.createElement('details');
  d.className = 'tool-call';
  const s = document.createElement('summary'); s.textContent = title; d.appendChild(s);
  const pre = document.createElement('pre'); pre.className = 'pre'; pre.innerHTML = Highlight(JSON.stringify(shorten(obj), null, 2), 'json');
  d.appendChild(pre);
  return d;
}

function renderOutput(turn, data, req) {
  const box = turn.body;
  box.innerHTML = '';
  const tool = (req.body.tools || []).find((t) => t.type === 'image_generation') || {};
  let shown = false;
  for (const it of data.output || []) {
    switch (it.type) {
      case 'message': {
        for (const c of it.content || []) {
          if (c.type === 'output_text') {
            const d = document.createElement('div'); d.innerHTML = Md.render(c.text || ''); box.appendChild(d); shown = true;
            const cites = [];
            for (const a of c.annotations || []) {
              if (a.type === 'url_citation') cites.push({ label: a.title || a.url, url: a.url });
              else if (a.type === 'file_citation' || a.type === 'container_file_citation') cites.push({ label: a.filename || a.file_id });
            }
            const uniq = cites.filter((x, i) => cites.findIndex((y) => y.label === x.label && y.url === x.url) === i);
            if (uniq.length) {
              const ol = document.createElement('ol'); ol.className = 'sources';
              for (const s of uniq) {
                const li = document.createElement('li');
                if (s.url && /^https?:/i.test(s.url)) { const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = s.label; li.appendChild(a); }
                else li.textContent = s.label;
                ol.appendChild(li);
              }
              box.appendChild(ol);
            }
          } else if (c.type === 'refusal') {
            const n = document.createElement('div'); n.className = 'notice warn'; n.textContent = 'The model refused: ' + (c.refusal || ''); box.appendChild(n); shown = true;
          }
        }
        break;
      }
      case 'reasoning': {
        const sum = (it.summary || []).map((s) => s.text).filter(Boolean).join('\n\n');
        if (sum) { const d = document.createElement('details'); d.className = 'tool-call'; const s = document.createElement('summary'); s.textContent = 'Reasoning summary'; const b = document.createElement('div'); b.className = 'md pre'; b.innerHTML = Md.render(sum); d.append(s, b); box.appendChild(d); }
        break;
      }
      case 'web_search_call': {
        const q = it.action && (it.action.query || (it.action.queries || []).join(' · '));
        box.appendChild(toolCall('Web search' + (q ? ' · ' + q : ''), it)); break;
      }
      case 'file_search_call': box.appendChild(toolCall('File search' + (it.queries ? ' · ' + it.queries.join(' · ') : ''), it)); break;
      case 'code_interpreter_call': {
        box.appendChild(toolCall('Code interpreter', it));
        if (it.code) box.insertAdjacentHTML('beforeend', '<div class="md">' + Md.render('```python\n' + it.code + '\n```') + '</div>');
        break;
      }
      case 'image_generation_call': {
        if (it.result) {
          const fmt = it.output_format || tool.output_format || 'png';
          const src = `data:image/${/^[a-z0-9]+$/.test(fmt) ? fmt : 'png'};base64,${it.result}`;
          const img = document.createElement('img'); img.className = 'gen-img'; img.alt = 'Generated image'; img.src = src;
          box.appendChild(img); shown = true;
          if (it.revised_prompt) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Revised prompt: ' + it.revised_prompt; box.appendChild(p); }
        } else box.appendChild(toolCall('Image generation', it));
        break;
      }
      default: box.appendChild(toolCall(`Output item · ${it.type}`, it));
    }
  }
  if (data.status === 'incomplete') {
    const why = data.incomplete_details && data.incomplete_details.reason;
    const n = document.createElement('div'); n.className = 'notice warn';
    n.textContent = `Response incomplete${why ? ' (' + why + ')' : ''}.` + (why === 'max_output_tokens' ? (shown ? ' Increase Max output tokens for a full answer.' : ' The limit was reached before any visible text — reasoning tokens count against it. Increase Max output tokens.') : '');
    box.appendChild(n);
  } else if (data.status === 'failed' && data.error) {
    const n = document.createElement('div'); n.className = 'notice err'; n.textContent = `Response failed: ${data.error.code || ''} ${data.error.message || ''}`; box.appendChild(n);
  }
  if (!box.childNodes.length) { const p = document.createElement('div'); p.className = 'muted'; p.textContent = 'The response contained no output items. See the Response tab.'; box.appendChild(p); }
}

async function run() {
  if (state.busy) { if (state.abort) state.abort.abort(); return; }
  if (!state.ready) return;
  const req = buildRequest();
  if (req.problems.length) {
    state.showProblems = true;
    state.inspectorMode = 'preview';
    renderRequestPane(req, 'Preview — what Run would send now');
    renderComposerNote(req);
    return;
  }
  cancelPreview();
  const atts = state.attachments.slice();
  state.showProblems = false;
  state.busy = true;
  state.abort = new AbortController();
  refreshRunButton(); refreshUploadButton();
  const turn = addTurn(req, atts);
  const t0 = performance.now();
  const timer = setInterval(() => { turn.pendEl.textContent = `Waiting for response… ${Math.round((performance.now() - t0) / 1000)} s`; }, 1000);
  let finalRes = null;
  try {
    const res = await api('POST', '/responses', { json: req.body, signal: state.abort.signal });
    const ms = Math.round(performance.now() - t0);
    const headers = []; res.res.headers.forEach((v, k) => headers.push(`${k}: ${v}`));
    turn.response = { status: res.res.status, ms, data: res.data, text: res.text, headers };
    finalRes = res.data;
    try { renderOutput(turn, res.data, req); }
    catch (re) { turn.body.innerHTML = `<div class="notice err">The response arrived but could not be displayed (${esc(re.message)}). Open the Response tab for the raw JSON.</div>`; }
    metaLinks(turn, `${res.data.status || 'completed'} · ${(ms / 1000).toFixed(1)} s${res.data.id ? ' · ' + res.data.id : ''}`);
    updateStats(res.data, req.body.model);
    showTurnInspector(turn);
    // the prompt and attachments were sent — clear the composer like a chat does (uploaded files stay listed for cleanup)
    $('prompt').value = ''; autosize();
    state.attachments = [];
    renderAttachments('', true);
    renderComposerNote(null);
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    if (e && e.name === 'AbortError') {
      turn.error = new ApiError({ kind: 'local', message: 'Request cancelled in the browser. OpenAI may still have processed it.' });
      turn.body.innerHTML = '<div class="notice warn">Stopped. The request was cancelled in the browser; OpenAI may still have processed it.</div>';
      metaLinks(turn, `cancelled · ${(ms / 1000).toFixed(1)} s`);
    } else {
      const ex = e instanceof ApiError ? e : networkError(e);
      turn.error = ex;
      turn.body.innerHTML = '';
      const n = document.createElement('div'); n.className = 'notice err';
      n.innerHTML = `<strong>${esc(ex.kind === 'network' ? 'Network error' : 'HTTP ' + ex.status + (ex.code ? ' · ' + ex.code : ''))}</strong><br>${esc(ex.message)}`;
      if (ex.requestId) n.innerHTML += `<br><span class="muted small">Request ID: ${esc(ex.requestId)}</span>`;
      turn.body.appendChild(n);
      metaLinks(turn, `error · ${(ms / 1000).toFixed(1)} s`);
      reportError(`Run · turn ${turn.n}`, ex);
      showTurnInspector(turn);
      setTab('errors');
    }
  } finally {
    clearInterval(timer);
    state.busy = false; state.abort = null;
    refreshRunButton(); refreshUploadButton();
    if (finalRes === null && !turn.error) metaLinks(turn, 'no response');
    scrollChat(true);
  }
}

/* ============================================================
   11. Knowledge base (vector stores)
   ============================================================ */
function vsLog(msg) {
  const log = $('vs-log');
  log.textContent += `[${stamp()}] ${msg}\n`;
  const lines = log.textContent.split('\n');
  if (lines.length > 200) log.textContent = lines.slice(-200).join('\n');
  log.scrollTop = log.scrollHeight;
}
function vsFail(what, e) {
  const ex = e instanceof ApiError ? e : networkError(e);
  vsLog(`${what} failed — ${errorLine(ex)}${ex.requestId ? ' (request ' + ex.requestId + ')' : ''}`);
  reportError('Knowledge base', ex);
}

async function loadVectorStores(selectId) {
  vsLog('Listing vector stores…');
  try {
    const stores = []; let after = null;
    for (let page = 0; page < 5; page++) {
      const { data } = await api('GET', `/vector_stores?limit=100&order=desc${after ? '&after=' + encodeURIComponent(after) : ''}`);
      stores.push(...(data.data || []));
      if (!data.has_more || !data.last_id) break;
      after = data.last_id;
    }
    state.vectorStores = stores;
    const sel = $('vs-select');
    const keep = selectId || sel.value;
    sel.innerHTML = '<option value="">— none selected —</option>';
    for (const s of stores) sel.add(new Option(`${s.name || '(unnamed)'} · ${s.id}`, s.id));
    sel.value = stores.some((s) => s.id === keep) ? keep : '';
    vsLog(`Found ${stores.length} vector store${stores.length === 1 ? '' : 's'}.`);
    await loadVsFiles();
  } catch (e) { vsFail('Listing vector stores', e); }
  onControlChange();
}

async function loadVsFiles() {
  const id = $('vs-select').value;
  const box = $('vs-files');
  if (!id) { box.innerHTML = '<span class="muted small">No vector store selected.</span>'; return; }
  box.innerHTML = '<span class="muted small">Loading…</span>';
  try {
    const { data } = await api('GET', `/vector_stores/${encodeURIComponent(id)}/files?limit=100`);
    const files = data.data || [];
    const names = await Promise.all(files.slice(0, 50).map(async (f) => {
      try { const r = await api('GET', '/files/' + encodeURIComponent(f.id)); return r.data.filename || f.id; } catch (_) { return f.id; }
    }));
    box.innerHTML = '';
    if (!files.length) { box.innerHTML = '<span class="muted small">This vector store has no files.</span>'; return; }
    files.forEach((f, i) => {
      const row = document.createElement('div'); row.className = 'vs-file';
      const name = document.createElement('span'); name.className = 'name'; name.textContent = names[i] || f.id; name.title = f.id;
      const st = document.createElement('span'); st.className = 'muted'; st.textContent = f.status + (f.last_error ? ' — ' + f.last_error.message : '');
      row.append(name, st); box.appendChild(row);
    });
    if (data.has_more) box.insertAdjacentHTML('beforeend', '<span class="muted small">Showing the first 100 files.</span>');
  } catch (e) { box.innerHTML = '<span class="muted small">Could not load files. See the log.</span>'; vsFail('Listing vector store files', e); }
}

async function createVectorStore() {
  const name = $('vs-name').value.trim();
  if (!name) { vsLog('Enter a name for the new vector store.'); return; }
  vsLog(`Creating vector store "${name}"…`);
  try {
    const { data } = await api('POST', '/vector_stores', { json: { name } });
    vsLog(`Created ${data.id}.`);
    $('vs-name').value = '';
    await loadVectorStores(data.id);
  } catch (e) { vsFail('Creating vector store', e); }
}

async function uploadToVectorStore(files) {
  const vs = $('vs-select').value;
  if (!vs) { vsLog('Select a vector store before uploading.'); $('vs-upload').value = ''; return; }
  for (const f of files) {
    try {
      vsLog(`Uploading ${f.name} (${fmtBytes(f.size)})…`);
      const form = new FormData();
      form.append('purpose', 'assistants');
      form.append('file', f, f.name);
      const up = await api('POST', '/files', { form });
      vsLog(`Uploaded as ${up.data.id}. Adding to ${vs}…`);
      const link = await api('POST', `/vector_stores/${encodeURIComponent(vs)}/files`, { json: { file_id: up.data.id } });
      let status = link.data.status;
      for (let i = 0; i < 40 && status === 'in_progress'; i++) {
        await sleep(1500);
        const { data } = await api('GET', `/vector_stores/${encodeURIComponent(vs)}/files/${encodeURIComponent(up.data.id)}`);
        status = data.status;
        if (data.last_error) vsLog(`${f.name}: ${data.last_error.code} — ${data.last_error.message}`);
      }
      vsLog(`${f.name}: ${status}.`);
    } catch (e) { vsFail(`Uploading ${f.name}`, e); }
  }
  $('vs-upload').value = '';
  await loadVsFiles();
}

/* ============================================================
   12. Layout + wiring
   ============================================================ */
const MIN_PANEL = 280, MAX_PANEL = 520, MIN_MAIN = 380;
function setPanelWidth(w) {
  const max = Math.max(MIN_PANEL, Math.min(MAX_PANEL, window.innerWidth - MIN_MAIN));
  w = Math.max(MIN_PANEL, Math.min(max, Math.round(w)));
  document.documentElement.style.setProperty('--panel-w', w + 'px');
  const r = $('resizer');
  r.setAttribute('aria-valuenow', String(w)); r.setAttribute('aria-valuemin', String(MIN_PANEL)); r.setAttribute('aria-valuemax', String(max));
  return w;
}
function initResizer() {
  const r = $('resizer');
  let dragging = false;
  r.addEventListener('pointerdown', (e) => { dragging = true; r.setPointerCapture && r.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); e.preventDefault(); });
  r.addEventListener('pointermove', (e) => { if (dragging) setPanelWidth(e.clientX - $('app').getBoundingClientRect().left); });
  const stop = () => { dragging = false; document.body.classList.remove('resizing'); };
  r.addEventListener('pointerup', stop); r.addEventListener('pointercancel', stop);
  r.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cur = $('panel').getBoundingClientRect().width;
    setPanelWidth(cur + (e.key === 'ArrowRight' ? 16 : -16));
    e.preventDefault();
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 900) setPanelWidth($('panel').getBoundingClientRect().width); });
}
function openPanel() { document.body.classList.add('panel-open'); }
function closePanel() { document.body.classList.remove('panel-open'); }

function autosize() {
  const p = $('prompt');
  p.style.height = 'auto';
  p.style.height = Math.min(p.scrollHeight, 220) + 'px';
}

let previewTimer = null;
function cancelPreview() { clearTimeout(previewTimer); previewTimer = null; }
function onControlChange() {
  cancelPreview();
  previewTimer = setTimeout(() => { state.inspectorMode = 'preview'; renderPreview(); }, 120);
}

function wire() {
  // connection
  $('init').addEventListener('click', init);
  $('api-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') init(); });
  $('api-key').addEventListener('input', () => {
    if (state.ready && $('api-key').value.trim() !== state.key) {
      state.ready = false; state.key = '';
      setLocked(true);
      setStatus($('init-status'), '', 'Key changed. Press INIT to connect again.');
    }
  });

  // models
  $('model-search').addEventListener('input', renderModels);
  $('show-all-models').addEventListener('change', renderModels);
  $('model').addEventListener('change', () => { applyCaps(); onControlChange(); });
  $('cap-override').addEventListener('change', () => { applyCaps(); onControlChange(); });
  $('reasoning').addEventListener('change', () => { applyCaps(); onControlChange(); });
  bindSlider('temperature'); bindSlider('top-p');

  // tools + any other input in the panel or composer refreshes the live request preview
  for (const id of ['tool-web', 'tool-files', 'tool-image', 'img-format']) $(id).addEventListener('change', syncToolPanels);
  $('workspace').addEventListener('input', onControlChange);
  $('workspace').addEventListener('change', onControlChange);
  $('prompt').addEventListener('input', () => { autosize(); onControlChange(); });

  // composer
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); run(); }
  });
  $('run').addEventListener('click', run);
  $('add-images').addEventListener('click', () => $('image-input').click());
  $('add-docs').addEventListener('click', () => $('doc-input').click());
  $('image-input').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addImages(f); });
  $('doc-input').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addDocs(f); });
  $('attachments').addEventListener('click', (e) => { const b = e.target.closest('[data-remove]'); if (b) removeAttachment(b.dataset.remove); });
  $('delete-uploads').addEventListener('click', () => deleteRemoteFiles(state.uploaded.map((u) => u.id)));

  // chat
  $('response').addEventListener('click', (e) => {
    const code = e.target.closest('[data-copy-code]');
    if (code) { flashCopy(code, code.closest('.code').querySelector('code').textContent); return; }
    const ins = e.target.closest('[data-inspect]');
    if (ins) { const t = state.turns[+ins.dataset.inspect - 1]; if (t) { showTurnInspector(t); setTab(t.error ? 'errors' : 'response'); } return; }
    const cp = e.target.closest('[data-copy-answer]');
    if (cp) { const t = state.turns[+cp.dataset.copyAnswer - 1]; if (t && t.response) flashCopy(cp, textOf(t.response.data)); }
  });
  $('clear-chat').addEventListener('click', () => {
    if (state.busy) return;
    state.turns = []; state.selected = null;
    $('response').innerHTML = '<div class="empty" id="empty-state"><p class="empty-title">◉ OpenAI API Desk</p><p>Conversation cleared. Each Run is an independent request.</p></div>';
    updateStats();
  });

  // inspector
  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => setTab(t.dataset.tab));
  $('inspector-toggle').addEventListener('click', () => setInspectorOpen($('inspector-body').hidden));
  $('copy-request').addEventListener('click', (e) => { if (state.lastRequest) flashCopy(e.currentTarget, JSON.stringify(state.lastRequest.body, null, 2)); });
  $('copy-curl').addEventListener('click', (e) => { if (state.lastRequest) flashCopy(e.currentTarget, curlText(state.lastRequest)); });
  const selTurn = () => state.turns[(state.selected || 0) - 1];
  $('copy-response').addEventListener('click', (e) => { const t = selTurn(); if (t && t.response) flashCopy(e.currentTarget, JSON.stringify(t.response.data, null, 2)); });
  $('download-response').addEventListener('click', () => { const t = selTurn(); if (t && t.response) downloadFile(`response-${t.response.data.id || 'turn-' + t.n}.json`, JSON.stringify(t.response.data, null, 2)); });

  // knowledge base
  $('vs-refresh').addEventListener('click', () => loadVectorStores());
  $('vs-select').addEventListener('change', () => { loadVsFiles(); onControlChange(); });
  $('vs-create').addEventListener('click', createVectorStore);
  $('vs-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') createVectorStore(); });
  $('vs-upload').addEventListener('change', (e) => uploadToVectorStore([...e.target.files]));

  // panel drawer on narrow screens
  $('panel-toggle').addEventListener('click', openPanel);
  $('panel-close').addEventListener('click', closePanel);
  $('scrim').addEventListener('click', closePanel);
}

function boot() {
  for (const pre of document.querySelectorAll('pre[data-lang]')) pre.innerHTML = Highlight(pre.textContent, pre.dataset.lang);
  setPanelWidth($('panel').getBoundingClientRect().width || 380);
  initResizer();
  wire();
  setLocked(true);
  applyCaps();
  renderPreview();
  if (window.matchMedia('(max-width: 900px)').matches) openPanel();
}
boot();
})();
