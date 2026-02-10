import { promises as fs } from 'fs';
import path from 'path';

const root = path.resolve(process.cwd());
const distDir = path.join(root, 'dist', 'firefox');

const copies = [
  'background',
  'content',
  'icons',
  'lib',
  'pages',
  'styles',
  'manifest.firefox.json'
];

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });

for (const item of copies) {
  const src = path.join(root, item);
  const destName = item === 'manifest.firefox.json' ? 'manifest.json' : item;
  const dest = path.join(distDir, destName);
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.cp(src, dest, { recursive: true });
  } else {
    await fs.copyFile(src, dest);
  }
}

console.log('Firefox build ready in dist/firefox');
