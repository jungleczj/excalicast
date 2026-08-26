import { readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const landing = path.join(root, 'public', 'landing');
const personaDirectory = path.join(landing, 'personas');

await sharp(path.join(landing, 'hero-generated-final.png'))
  .resize({ width: 1600, withoutEnlargement: true })
  .webp({ quality: 78, effort: 6 })
  .toFile(path.join(landing, 'hero-generated-final.webp'));

for (const filename of await readdir(personaDirectory)) {
  if (!filename.endsWith('.png')) continue;
  await sharp(path.join(personaDirectory, filename))
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 76, effort: 6 })
    .toFile(path.join(personaDirectory, filename.replace(/\.png$/, '.webp')));
}

console.log('Optimized landing hero and persona images.');
