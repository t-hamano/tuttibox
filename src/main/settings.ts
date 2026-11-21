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
	/** Seconds between unread count checks. 0 turns the checks off */
	pollInterval: number;
}

export interface Settings {
	bounds?: { x: number; y: number; width: number; height: number };
	maximized?: boolean;
	activeServiceId?: string;
	services: ServiceConfig[];
}

/** Choices offered in the edit window, in seconds */
export const POLL_INTERVALS = [ 0, 2, 5, 10, 30, 60 ];

export function normalizePollInterval( value: unknown, fallback = 0 ): number {
	return POLL_INTERVALS.includes( value as number ) ? ( value as number ) : fallback;
}

const file = () => join( app.getPath( 'userData' ), 'settings.json' );

export function loadSettings(): Settings {
	// `pollInterval` was an app-wide setting before it moved to each service
	let saved: Partial< Settings > & { pollInterval?: number } = {};
	try {
		saved = JSON.parse( readFileSync( file(), 'utf8' ) ) as typeof saved;
	} catch {
		// First launch
	}
	const { pollInterval: appPollInterval, ...rest } = saved;
	const fallback = normalizePollInterval( appPollInterval );
	return {
		...rest,
		// Start with no services; the user adds them from the "+" button
		services: Array.isArray( saved.services )
			? saved.services.map( ( service ) => ( {
					...service,
					pollInterval: normalizePollInterval( service.pollInterval, fallback ),
			  } ) )
			: [],
	};
}

export function saveSettings( settings: Settings ): void {
	try {
		writeFileSync( file(), JSON.stringify( settings, null, 2 ) );
	} catch ( error ) {
		console.error( 'Failed to save settings', error );
	}
}
