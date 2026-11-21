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

// Title bar icon and tray icons used on Windows / Linux: ICO on Windows, PNG plus @1.25x / @1.5x / @2x on Linux
mkdirSync('dist/assets', { recursive: true });
cpSync('build/icon-win.png', 'dist/assets/icon.png');
for (const file of readdirSync('build')) {
	if (/^tray(-unread)?((@[\d.]+x)?\.png|\.ico)$/.test(file)) {
		cpSync(join('build', file), join('dist/assets', file));
	}
}
