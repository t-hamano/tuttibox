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

// Window icon and tray icons (tray.png plus @1.25x / @1.5x / @2x for high DPI) used on Windows / Linux
mkdirSync('dist/assets', { recursive: true });
cpSync('build/icon-win.png', 'dist/assets/icon.png');
for (const file of readdirSync('build')) {
	if (/^tray(@[\d.]+x)?\.png$/.test(file)) {
		cpSync(join('build', file), join('dist/assets', file));
	}
}
