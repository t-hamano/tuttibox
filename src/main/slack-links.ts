import { app } from 'electron';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Slack's web pages (e.g. https://example.slack.com/archives/C123/p1700000000000100)
 * try to open the desktop app through a slack:// link. When Slack's desktop app is not
 * installed, Tuttibox handles those links and opens them in its Slack service instead.
 */
const PROTOCOL = 'slack';
const SLACK_MAC_BUNDLE_ID = 'com.tinyspeck.slackmacgap';

/** Where a slack:// link points */
export interface SlackLink {
	team?: string;
	channel?: string;
	/** Timestamp of the root message when the link points into a thread */
	threadTs?: string;
}

/** Slack IDs and timestamps only contain these characters, so nothing else can reach the URL */
const ID_PATTERN = /^[A-Z0-9]+$/i;
const TS_PATTERN = /^\d+\.\d+$/;

/**
 * Register Tuttibox as the slack:// handler, unless another app (Slack itself) already is.
 * On macOS the scheme is declared in Info.plist (see "protocols" in package.json).
 */
export function registerSlackProtocol(): void {
	const current = app.getApplicationNameForProtocol( `${ PROTOCOL }://` );
	if ( current && ! isOwnApp( current ) ) {
		return;
	}
	if ( process.defaultApp && process.argv[ 1 ] ) {
		// Development: Electron needs the app path to launch this app
		app.setAsDefaultProtocolClient( PROTOCOL, process.execPath, [ resolve( process.argv[ 1 ] ) ] );
	} else {
		app.setAsDefaultProtocolClient( PROTOCOL );
	}
}

function isOwnApp( name: string ): boolean {
	const lower = name.toLowerCase();
	return lower.includes( app.getName().toLowerCase() ) || lower.includes( 'electron' );
}

/** Find a slack:// link in command line arguments (Windows / Linux launch and second instance) */
export function findSlackUrl( argv: string[] ): string | undefined {
	return argv.find( ( arg ) => arg.toLowerCase().startsWith( `${ PROTOCOL }:` ) );
}

export function parseSlackUrl( url: string ): SlackLink | undefined {
	let parsed: URL;
	try {
		parsed = new URL( url );
	} catch {
		return undefined;
	}
	if ( parsed.protocol !== `${ PROTOCOL }:` ) {
		return undefined;
	}
	const param = ( name: string, pattern: RegExp ) => {
		const value = parsed.searchParams.get( name );
		return value && pattern.test( value ) ? value : undefined;
	};
	const link: SlackLink = { team: param( 'team', ID_PATTERN ) };
	// e.g. slack://channel?team=T123&id=C123&message=1700000000.000100&thread_ts=1700000000.000000
	if ( parsed.hostname === 'channel' ) {
		link.channel = param( 'id', ID_PATTERN );
		link.threadTs = param( 'thread_ts', TS_PATTERN );
	}
	return link;
}

/** URL in Slack's web client that shows the linked channel or thread */
export function slackWebUrl( link: SlackLink, fallbackTeam?: string ): string | undefined {
	const team = link.team ?? fallbackTeam;
	if ( ! team ) {
		return undefined;
	}
	let url = `https://app.slack.com/client/${ team }`;
	if ( link.channel ) {
		url += `/${ link.channel }`;
		if ( link.threadTs ) {
			url += `/thread/${ link.channel }-${ link.threadTs }`;
		}
	}
	return url;
}

/** Team ID of the workspace a Slack web client URL shows */
export function teamOfSlackWebUrl( url: string ): string | undefined {
	return url.match( /^https:\/\/app\.slack\.com\/client\/([A-Z0-9]+)/i )?.[ 1 ];
}

/**
 * On macOS, Slack may be installed even though Tuttibox became the handler
 * (macOS picks one when several apps declare the scheme). Hand the link to Slack then.
 * Resolves to false when Slack is not installed.
 */
export function openInSlackApp( url: string ): Promise< boolean > {
	if ( process.platform !== 'darwin' ) {
		return Promise.resolve( false );
	}
	return new Promise( ( done ) => {
		execFile( 'open', [ '-b', SLACK_MAC_BUNDLE_ID, url ], ( error ) => done( ! error ) );
	} );
}
