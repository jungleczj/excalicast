import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageRoot = path.join(root, 'native/mac-media-engine');
const scratchRoot = path.join(packageRoot, '.build-release');
execFileSync('swift', [
  'build', '--configuration', 'release', '--package-path', packageRoot,
  '--scratch-path', scratchRoot, '--product', 'mac-media-engine',
], { stdio: 'inherit' });

const candidates = [
  path.join(scratchRoot, 'arm64-apple-macosx', 'release', 'mac-media-engine'),
  path.join(scratchRoot, 'release', 'mac-media-engine'),
];
const source = candidates.find(existsSync);
if (!source) throw new Error('mac_media_engine_release_binary_missing');
const destinationDirectory = path.join(root, 'apps/desktop/build/bin');
mkdirSync(destinationDirectory, { recursive: true });
const destination = path.join(destinationDirectory, 'mac-media-engine');
copyFileSync(source, destination);
chmodSync(destination, 0o755);
