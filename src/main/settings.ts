import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Settings for one service added to the sidebar */
export interface ServiceConfig {
	/** Instance ID. Also used as the session partition name */
	id: string;
	/** `type` of an entry in serviceTypes */
	type: string;
	/** Display name (tooltip) */
	name: string;
	/** Whether to show the unread badge */
	badge: boolean;
	/** JavaScript run after each page load */
	js: string;
}

export interface Settings {
	bounds?: { x: number; y: number; width: number; height: number };
	maximized?: boolean;
	activeServiceId?: string;
	/** Seconds between unread count checks. 0 turns the checks off */
	pollInterval: number;
	services: ServiceConfig[];
}

/** Choices offered in the settings window, in seconds */
export const POLL_INTERVALS = [ 0, 2, 5, 10, 30, 60 ];

const file = () => join( app.getPath( 'userData' ), 'settings.json' );

export function loadSettings(): Settings {
	let saved: Partial< Settings > = {};
	try {
		saved = JSON.parse( readFileSync( file(), 'utf8' ) ) as Partial< Settings >;
	} catch {
		// First launch
	}
	return {
		...saved,
		pollInterval: POLL_INTERVALS.includes( saved.pollInterval as number )
			? ( saved.pollInterval as number )
			: 0,
		// Start with no services; the user adds them from the "+" button
		services: Array.isArray( saved.services ) ? saved.services : [],
	};
}

export function saveSettings( settings: Settings ): void {
	try {
		writeFileSync( file(), JSON.stringify( settings, null, 2 ) );
	} catch ( error ) {
		console.error( 'Failed to save settings', error );
	}
}
