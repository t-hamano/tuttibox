import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Settings {
	bounds?: { x: number; y: number; width: number; height: number };
	maximized?: boolean;
	activeServiceId?: string;
}

const file = () => join( app.getPath( 'userData' ), 'settings.json' );

export function loadSettings(): Settings {
	try {
		return JSON.parse( readFileSync( file(), 'utf8' ) ) as Settings;
	} catch {
		return {};
	}
}

export function saveSettings( settings: Settings ): void {
	try {
		writeFileSync( file(), JSON.stringify( settings, null, 2 ) );
	} catch ( error ) {
		console.error( 'Failed to save settings', error );
	}
}
