// Copy files that tsc does not emit (HTML, CSS, etc.) to dist
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = 'src/renderer';
const dest = 'dist/renderer';
for (const file of readdirSync(src)) {
	if (!file.endsWith('.ts')) {
		cpSync(join(src, file), join(dest, file));
	}
}

// Tray icon used on Windows / Linux
mkdirSync('dist/assets', { recursive: true });
cpSync('build/icon-win.png', 'dist/assets/tray.png');
