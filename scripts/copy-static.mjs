// HTML / CSS など tsc が出力しないファイルを dist にコピーする
import { cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = 'src/renderer';
const dest = 'dist/renderer';
for (const file of readdirSync(src)) {
	if (!file.endsWith('.ts')) {
		cpSync(join(src, file), join(dest, file));
	}
}
