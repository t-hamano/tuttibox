import { randomUUID } from 'node:crypto';
import { findServiceType } from './services';
import { normalizePollInterval, type ServiceConfig } from './settings';

/** Identifies an exported file */
const FORMAT = 'tuttibox-settings';
const VERSION = 1;

/** One service in an exported file. Login sessions and IDs are not included */
export interface ExportedService {
	type: string;
	name: string;
	badge: boolean;
	js: string;
	pollInterval: number;
}

interface ExportFile {
	format: typeof FORMAT;
	version: number;
	services: ExportedService[];
}

/** Serialize services, in sidebar order, to the export file contents */
export function serializeServices( services: ServiceConfig[] ): string {
	const data: ExportFile = {
		format: FORMAT,
		version: VERSION,
		services: services.map( ( { type, name, badge, js, pollInterval } ) => ( {
			type,
			name,
			badge,
			js,
			pollInterval,
		} ) ),
	};
	return JSON.stringify( data, null, 2 ) + '\n';
}

export interface ParseResult {
	/** New service configs with fresh IDs, in file order */
	services: ServiceConfig[];
	/** Number of entries skipped because the app is not supported */
	skipped: number;
}

/** Parse export file contents. Throws when the file is not a Tuttibox export */
export function parseServices( text: string ): ParseResult {
	let data: unknown;
	try {
		data = JSON.parse( text );
	} catch {
		throw new Error( 'The file is not valid JSON.' );
	}
	if (
		! isObject( data ) ||
		data.format !== FORMAT ||
		! Array.isArray( data.services )
	) {
		throw new Error( 'The file is not a Tuttibox settings file.' );
	}
	if ( typeof data.version !== 'number' || data.version > VERSION ) {
		throw new Error( 'The file was created by a newer version of Tuttibox.' );
	}

	const services: ServiceConfig[] = [];
	let skipped = 0;
	for ( const entry of data.services ) {
		const type = isObject( entry ) && typeof entry.type === 'string' ? findServiceType( entry.type ) : undefined;
		if ( ! isObject( entry ) || ! type ) {
			skipped++;
			continue;
		}
		services.push( {
			id: `${ type.type }-${ randomUUID() }`,
			type: type.type,
			name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : type.label,
			badge: typeof entry.badge === 'boolean' ? entry.badge : true,
			js: typeof entry.js === 'string' ? entry.js : '',
			pollInterval: normalizePollInterval( entry.pollInterval ),
		} );
	}
	return { services, skipped };
}

function isObject( value: unknown ): value is Record< string, unknown > {
	return typeof value === 'object' && value !== null && ! Array.isArray( value );
}
