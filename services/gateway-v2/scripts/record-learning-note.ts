import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

function loadLocalEnv(): void {
  const candidates = [
    join(process.cwd(), '.env.local'),
    join(process.cwd(), 'gateway', '.env.local'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1]?.trim();
  return undefined;
}

function readTags(): string[] {
  const tags = process.argv
    .filter(arg => arg.startsWith('--tag='))
    .map(arg => arg.slice('--tag='.length).trim())
    .filter(Boolean);

  const commaTags = readArg('tags')?.split(',').map(tag => tag.trim()).filter(Boolean) || [];
  return [...tags, ...commaTags];
}

const title = readArg('title');
const content = readArg('content');
const category = readArg('category') as 'finance' | 'custom' | 'pattern' | 'solution' | undefined;
const source = readArg('source');
const tags = readTags();

if (!title || !content) {
  console.error('Usage: npm run trident:note -- --title "Title" --content "Learning note" --tags tag1,tag2');
  process.exit(1);
}

loadLocalEnv();
const { brain } = await import('../src/brain-client.js');

const connected = await brain.checkHealth();
if (!connected) {
  console.error('Trident health check failed. Verify BRAIN_SERVER_URL and BRAIN_API_KEY.');
  process.exit(1);
}

const ok = await brain.recordLearningNote({ title, content, category, source, tags });
if (!ok) {
  console.error('Failed to record learning note in Trident.');
  process.exit(1);
}

console.log(`Recorded Trident learning note: ${title}`);
