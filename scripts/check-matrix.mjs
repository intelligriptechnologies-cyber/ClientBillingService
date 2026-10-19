import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((v) => v !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function checkMatrix(rows, exists) {
  return rows
    .filter((r) => r.ours === 'built')
    .map((r) => {
      const paths = r.evidence.split(';').map((item) => item.trim().replace(/:\d+(-\d+)?$/, ''));
      return { id: r.id, evidence: r.evidence, ok: paths.every((path) => path !== '' && exists(path)) };
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const rows = parseCsv(readFileSync(resolve(root, 'billing-roadmap-matrix.csv'), 'utf8'));
  const results = checkMatrix(rows, (p) => existsSync(resolve(root, p)));
  console.log(`${'id'.padEnd(28)}${'status'.padEnd(9)}evidence`);
  for (const r of results) console.log(`${r.id.padEnd(28)}${(r.ok ? 'ok' : 'MISSING').padEnd(9)}${r.evidence}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${rows.length} rows, ${results.length} built, ${bad} missing evidence`);
  process.exit(bad ? 1 : 0);
}
