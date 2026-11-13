// Minimal workflow YAML structural validator (no external deps)
import fs from 'node:fs';
import path from 'node:path';

const dir = '.github/workflows';
const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/i.test(f));
if (!files.length) { console.log('No workflow files found.'); process.exit(0); }

let failures = 0;
for (const file of files) {
  const raw = fs.readFileSync(path.join(dir, file), 'utf8');
  const lines = raw.split(/\r?\n/);
  const issues = [];
  // A workflow file must not be Markdown
  if (/^#.+|^##.+/.test(lines[0]) && !raw.includes('\nname:')) issues.push('looks like Markdown, not YAML');
  if (raw.includes('## ')) issues.push('contains Markdown headings');
  // Required top-level keys
  const has = key => lines.some(l => new RegExp(`^${key}:`).test(l));
  for (const key of ['name', 'on', 'jobs']) if (!has(key)) issues.push(`missing top-level '${key}:'`);
  if (!lines.some(l => /^\s+runs-on:/.test(l))) issues.push("missing 'runs-on'");
  if (!lines.some(l => /^\s+steps:/.test(l))) issues.push("missing 'steps:'");
  // Indentation sanity: 'on:' must not be interpreted as boolean True (YAML 1.1 pitfall)
  if (!/^on:\s*$/m.test(raw.replace(/^\uFEFF/, ''))) issues.push("'on:' key not at column 1");
  // tabs check
  if (/\t/.test(raw)) issues.push('contains tab characters (invalid YAML indentation)');
  // action versions
  const uses = [...raw.matchAll(/uses:\s*([\w./-]+)@(\S+)/g)].map(m => [m[1], m[2]]);
  for (const [action, ver] of uses) {
    if (!/^v\d+$/.test(ver)) issues.push(`action ${action} uses non-tag version '${ver}'`);
    const major = Number(ver.slice(1));
    const expected = {
      'actions/checkout': 4, 'actions/setup-node': 4, 'actions/upload-pages-artifact': 3,
      'actions/configure-pages': 5, 'actions/deploy-pages': 4,
    }[action];
    if (expected && major < expected) issues.push(`action ${action} at ${ver}, expected v${expected}+`);
  }
  // permissions present
  if (!has('permissions')) issues.push("missing 'permissions:' block");
  if (issues.length) { failures++; console.log(`FAIL ${file}:\n  - ${issues.join('\n  - ')}`); }
  else console.log(`PASS ${file} (${lines.length} lines, ${uses.length} actions: ${uses.map(u => u[0] + '@' + u[1]).join(', ')})`);
}
process.exitCode = failures ? 1 : 0;
