import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(project, 'dist');
if (existsSync(output)) rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(join(project, 'index.html'), join(output, 'index.html'));
cpSync(join(project, 'src'), join(output, 'src'), { recursive: true });
for (const entry of readdirSync(join(project, 'public'), { withFileTypes: true })) {
  const source = join(project, 'public', entry.name);
  const target = join(output, entry.name);
  cpSync(source, target, { recursive: true });
}
console.log('Static PWA built to dist/');
