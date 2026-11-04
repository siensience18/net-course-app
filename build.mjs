// Собирает статический сайт курса в docs/.
// Использование: node build.mjs [путь_к_курсу]
// Логин/пароль можно переопределить через COURSE_LOGIN / COURSE_PASSWORD.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { webcrypto as crypto, createHash } from 'node:crypto';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = path.resolve(process.argv[2] || path.join(ROOT, '..', 'net-course'));
const OUT = path.join(ROOT, 'docs');
const LOGIN = process.env.COURSE_LOGIN || 'sien';
const PASSWORD = process.env.COURSE_PASSWORD || '123321';

// Должны совпадать с src/app.js
const SALT_TEXT = 'net-course/v1';
const ITERATIONS = 250000;

const SKIP_DIRS = new Set(['__pycache__', '.git', 'node_modules', '.venv', '.pytest_cache']);
const SKIP_EXT = new Set(['.pyc', '.pyo', '.so', '.exe', '.zip', '.png', '.jpg', '.pcap', '.pcapng']);

function walk(dir, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) out.push(...walk(path.join(dir, ent.name), r));
    } else if (!SKIP_EXT.has(path.extname(ent.name).toLowerCase())) {
      out.push(r);
    }
  }
  return out;
}

function readText(abs) {
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) return null;
  return buf.toString('utf8').replace(/\r\n/g, '\n');
}

const files = {};
for (const rel of walk(SRC)) {
  const text = readText(path.join(SRC, rel));
  if (text !== null) files[rel] = text;
}
if (!files['README.md']) throw new Error(`Не найден README.md в ${SRC}`);

const moduleIds = [...new Set(Object.keys(files).map((f) => f.split('/')[0]))]
  .filter((d) => /^\d\d-/.test(d) && files[`${d}/README.md`])
  .sort();

const modules = moduleIds.map((id) => {
  const readme = files[`${id}/README.md`];
  const h1 = (readme.match(/^#\s+(.+)$/m) || [, id])[1].trim();
  const title = h1.replace(/^Модуль\s+\d+\.?\s*/i, '').trim() || h1;
  return {
    id,
    num: id.slice(0, 2),
    title,
    fullTitle: h1,
    readme: `${id}/README.md`,
    files: Object.keys(files).filter((f) => f.startsWith(`${id}/`) && f !== `${id}/README.md`),
  };
});

// Группировка модулей по частям из корневого README ("### Часть ..." + ссылки в таблицах)
const parts = [];
let cur = null;
for (const line of files['README.md'].split('\n')) {
  const h = line.match(/^###\s+(.+)$/);
  if (h) {
    cur = { title: h[1].trim(), modules: [] };
    parts.push(cur);
    continue;
  }
  const m = line.match(/\]\((\d\d-[^/)]+)\/README\.md\)/);
  if (m && cur && moduleIds.includes(m[1]) && !cur.modules.includes(m[1])) cur.modules.push(m[1]);
}
const grouped = parts.filter((p) => p.modules.length);
const inParts = new Set(grouped.flatMap((p) => p.modules));
const rest = moduleIds.filter((id) => !inParts.has(id));
if (rest.length) grouped.push({ title: grouped.length ? 'Прочее' : 'Модули', modules: rest });

const courseTitle = (files['README.md'].match(/^#\s+(.+)$/m) || [, 'Курс'])[1].trim();
const extraFiles = Object.keys(files).filter((f) => !f.includes('/') && f !== 'README.md');
const toolFiles = Object.keys(files).filter((f) => f.includes('/') && !moduleIds.includes(f.split('/')[0]));

const payload = {
  title: courseTitle,
  builtAt: new Date().toISOString(),
  parts: grouped,
  modules,
  extra: [...extraFiles, ...toolFiles],
  files,
};

const json = Buffer.from(JSON.stringify(payload), 'utf8');
const gz = zlib.gzipSync(json, { level: 9 });

const enc = new TextEncoder();
const baseKey = await crypto.subtle.importKey(
  'raw', enc.encode(`${LOGIN.trim().toLowerCase()}\n${PASSWORD}`), 'PBKDF2', false, ['deriveKey'],
);
const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(SALT_TEXT)));
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
  baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, gz));
const blob = Buffer.concat([Buffer.from(iv), Buffer.from(ct)]);

fs.mkdirSync(OUT, { recursive: true });
for (const ent of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, ent), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'data.bin'), blob);

const ver = createHash('sha256')
  .update(blob)
  .update(fs.readFileSync(path.join(ROOT, 'src', 'app.js')))
  .update(fs.readFileSync(path.join(ROOT, 'src', 'style.css')))
  .digest('hex').slice(0, 10);

const vendor = [
  ['node_modules/marked/lib/marked.umd.js', 'marked.js'],
  ['node_modules/@highlightjs/cdn-assets/highlight.min.js', 'highlight.js'],
];
for (const lang of ['powershell', 'http', 'dockerfile', 'nginx']) {
  vendor.push([`node_modules/@highlightjs/cdn-assets/languages/${lang}.min.js`, `hl-${lang}.js`]);
}
for (const [from, to] of vendor) fs.copyFileSync(path.join(ROOT, from), path.join(OUT, 'vendor', to));

const vendorTags = vendor.map(([, to]) => `<script src="vendor/${to}?v=${ver}" defer></script>`).join('\n  ');
const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8')
  .replaceAll('__VER__', ver)
  .replace('<!--VENDOR-->', vendorTags);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
for (const f of ['app.js', 'style.css', 'manifest.webmanifest', 'icon.svg']) {
  fs.copyFileSync(path.join(ROOT, 'src', f), path.join(OUT, f));
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

console.log(`Курс: ${SRC}`);
console.log(`Модулей: ${modules.length}, файлов: ${Object.keys(files).length}`);
console.log(`JSON ${(json.length / 1024).toFixed(0)} КБ -> gzip+AES ${(blob.length / 1024).toFixed(0)} КБ, версия ${ver}`);
