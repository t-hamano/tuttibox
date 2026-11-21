import {
	app,
	BaseWindow,
	BrowserWindow,
	Menu,
	WebContentsView,
	clipboard,
	dialog,
	ipcMain,
	nativeImage,
	session,
	shell,
	Tray,
	type MenuItemConstructorOptions,
	type Rectangle,
	type WebContents,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findServiceType, serviceTypes, type ServiceType } from './services';
import {
	loadSettings,
	normalizePollInterval,
	POLL_INTERVALS,
	saveSettings,
	type ServiceConfig,
} from './settings';
import { parseServices, serializeServices } from './transfer';
import { checkForUpdatesFromMenu, setupAutoUpdate } from './updater';

const SIDEBAR_WIDTH = 64;
/** Thickness of the top border. Views are shifted down by this amount so the window background shows through as a line */
const TOP_BORDER = 1;
const BORDER_COLOR = '#d9d9de';
const isMac = process.platform === 'darwin';
/**
 * Height of the custom title bar on Windows / Linux. Like Ferdium, the menu is drawn inside
 * the title bar instead of a separate native menu bar row. macOS keeps its native title bar.
 */
const TITLEBAR_HEIGHT = isMac ? 0 : 32;
const TITLEBAR_COLOR = '#ffffff';
const TITLEBAR_SYMBOL_COLOR = '#1c1d2e';

interface ServiceState {
	config: ServiceConfig;
	type: ServiceType;
	view: WebContentsView;
	/** Unread count read from the title (kept even when the badge is disabled) */
	unread: number;
	icon?: string;
	pollTimer?: ReturnType< typeof setInterval >;
}

/** Display data sent to the sidebar */
export interface SidebarItem {
	id: string;
	name: string;
	color: string;
	icon?: string;
	badge: number;
	active: boolean;
}

/** Data shown in the settings window */
export interface AppSettingsData {
	openAtLogin: boolean;
	supportsOpenAtLogin: boolean;
}

/** Data exchanged with the edit window */
export interface EditData {
	name: string;
	badge: boolean;
	js: string;
	pollInterval: number;
	pollIntervals: number[];
	typeLabel: string;
	supportsBadge: boolean;
}

// Some sites reject the UA when it contains Electron or the app name, so use a plain Chrome UA
app.userAgentFallback = app.userAgentFallback
	.replace( /\sElectron\/\S+/, '' )
	.replace( new RegExp( `\\s${ app.getName() }/\\S+`, 'i' ), '' );

/**
 * Google sign-in blocks embedded Chromium even with a plain Chrome UA
 * ("This browser or app may not be secure"). Like Ferdium, drop the Chrome
 * version from the UA while on the sign-in host.
 */
const SIGN_IN_HOST = 'accounts.google.com';
const SIGN_IN_USER_AGENT = app.userAgentFallback.replace( /Chrome\/[\d.]+/, 'Chrome' );

const gotLock = app.requestSingleInstanceLock();
if ( ! gotLock ) {
	app.quit();
}

let win: BaseWindow | null = null;
let sidebar: WebContentsView;
/** Custom title bar with the app icon and the menu (Windows / Linux only) */
let titlebar: WebContentsView | null = null;
/** Shown in the content area while no services have been added */
let emptyView: WebContentsView;
/** In sidebar order */
const states: ServiceState[] = [];
let activeId: string | undefined;
let quitting = false;
/** Notification area icon (Windows / Linux). Kept in a variable so it is not garbage collected */
let tray: Tray | null = null;
const settings = loadSettings();
/** Edit window webContents.id -> service ID */
const editWindows = new Map< number, string >();
let settingsWindow: BrowserWindow | null = null;
/** Electron can register the app to launch at login only on macOS and Windows */
const supportsOpenAtLogin = process.platform === 'darwin' || process.platform === 'win32';

function createWindow(): void {
	win = new BaseWindow( {
		width: settings.bounds?.width ?? 1280,
		height: settings.bounds?.height ?? 800,
		x: settings.bounds?.x,
		y: settings.bounds?.y,
		minWidth: 600,
		minHeight: 400,
		title: 'Tuttibox',
		backgroundColor: BORDER_COLOR,
		// Hide the native title bar and menu bar, keeping only the window buttons
		...( isMac
			? {}
			: {
					titleBarStyle: 'hidden' as const,
					titleBarOverlay: {
						color: TITLEBAR_COLOR,
						symbolColor: TITLEBAR_SYMBOL_COLOR,
						height: TITLEBAR_HEIGHT,
					},
			  } ),
	} );
	if ( settings.maximized ) {
		win.maximize();
	}
	if ( ! isMac ) {
		titlebar = new WebContentsView( {
			webPreferences: {
				preload: join( __dirname, '../preload/titlebar.js' ),
				sandbox: true,
				contextIsolation: true,
			},
		} );
		win.contentView.addChildView( titlebar );
		titlebar.webContents.on( 'did-finish-load', pushTitlebarMenus );
		titlebar.webContents.loadFile( join( __dirname, '../renderer/titlebar.html' ) );
	}

	sidebar = new WebContentsView( {
		webPreferences: {
			preload: join( __dirname, '../preload/sidebar.js' ),
			sandbox: true,
			contextIsolation: true,
		},
	} );
	win.contentView.addChildView( sidebar );
	sidebar.webContents.loadFile( join( __dirname, '../renderer/sidebar.html' ) );
	sidebar.webContents.on( 'did-finish-load', pushSidebarState );

	emptyView = new WebContentsView( {
		webPreferences: {
			preload: join( __dirname, '../preload/sidebar.js' ),
			sandbox: true,
			contextIsolation: true,
		},
	} );
	win.contentView.addChildView( emptyView );
	emptyView.webContents.loadFile( join( __dirname, '../renderer/empty.html' ) );

	for ( const config of settings.services ) {
		createServiceView( config );
	}

	const initial =
		states.find( ( state ) => state.config.id === settings.activeServiceId ) ?? states[ 0 ];
	if ( initial ) {
		activate( initial.config.id );
	}
	updateEmptyState();

	win.on( 'resize', layout );
	win.on( 'close', ( event ) => {
		persistWindow();
		// Keep the app running when the window is closed. It stays in the Dock on macOS
		// and in the notification area on Windows / Linux; quit from the menu or the tray
		if ( ! quitting ) {
			event.preventDefault();
			win?.hide();
		}
	} );
	// Do not block Windows shutdown / sign-out by hiding the window instead of closing it
	win.on( 'query-session-end', () => {
		quitting = true;
	} );
	win.on( 'closed', () => {
		win = null;
	} );
	layout();
}

function createServiceView( config: ServiceConfig ): ServiceState | undefined {
	const type = findServiceType( config.type );
	if ( ! type ) {
		return undefined;
	}
	const partition = `persist:${ config.id }`;
	setupSession( partition );

	const view = new WebContentsView( {
		webPreferences: {
			partition,
			preload: join( __dirname, '../preload/service.js' ),
			sandbox: true,
			contextIsolation: true,
			spellcheck: false,
		},
	} );
	// Size the view before hiding it. A view hidden before it has a size loads its page
	// at 0x0, and some pages (e.g. Google Calendar's month view) keep that broken layout
	// even after the view is shown and resized
	view.setBounds( getContentBounds() );
	view.setVisible( false );
	win!.contentView.addChildView( view );

	const state: ServiceState = { config, type, view, unread: 0, icon: type.icon };
	states.push( state );
	startPolling( state );

	const wc = view.webContents;
	handleSignInUserAgent( wc );

	wc.on( 'did-finish-load', () => {
		runCustomJs( state );
	} );

	wc.on( 'page-title-updated', ( _event, title ) => {
		if ( ! type.parseBadge ) {
			return;
		}
		// The count is not in the title, so read it from the page
		if ( type.pollScript ) {
			void pollService( state );
			return;
		}
		setUnread( state, type.parseBadge( title ) );
	} );

	const serviceHost = new URL( type.url ).hostname;
	wc.on( 'page-favicon-updated', ( _event, favicons ) => {
		// The service type has a fixed icon
		if ( type.icon ) {
			return;
		}
		// Ignore icons of other pages such as the sign-in page (Google's logo instead of Gmail's)
		if ( hostnameOf( wc.getURL() ) !== serviceHost ) {
			return;
		}
		if ( favicons[ 0 ] && favicons[ 0 ] !== state.icon ) {
			state.icon = favicons[ 0 ];
			pushSidebarState();
		}
	} );

	wc.setWindowOpenHandler( ( { url, disposition } ) => {
		if ( isInternalUrl( url, type ) ) {
			// Links that would open in a new tab (e.g. "Sign in" on Google's landing page)
			// load in the service view itself, so signing in there signs in the service
			if ( disposition === 'foreground-tab' || disposition === 'background-tab' ) {
				wc.loadURL( url );
				return { action: 'deny' };
			}
			// Real popups (window.open with a size) stay popups, as the opener may wait for them
			return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
		}
		openExternal( url );
		return { action: 'deny' };
	} );

	wc.on( 'context-menu', ( _event, params ) => {
		const template: MenuItemConstructorOptions[] = [];
		if ( params.linkURL ) {
			template.push(
				{ label: 'Open Link in Browser', click: () => openExternal( params.linkURL ) },
				{ label: 'Copy Link', click: () => clipboard.writeText( params.linkURL ) },
				{ type: 'separator' }
			);
		}
		if ( params.isEditable ) {
			template.push( { role: 'cut', label: 'Cut' } );
		}
		template.push( { role: 'copy', label: 'Copy', enabled: params.selectionText.length > 0 || params.isEditable } );
		if ( params.isEditable ) {
			template.push( { role: 'paste', label: 'Paste' } );
		}
		template.push(
			{ role: 'selectAll', label: 'Select All' },
			{ type: 'separator' },
			{ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
			{ label: 'Reload', click: () => wc.reload() }
		);
		Menu.buildFromTemplate( template ).popup();
	} );

	// Retry after a short delay when loading fails (e.g. offline)
	wc.on( 'did-fail-load', ( _event, errorCode, _desc, _url, isMainFrame ) => {
		// -3 is ERR_ABORTED (cancelled by the user)
		if ( isMainFrame && errorCode !== -3 ) {
			setTimeout( () => {
				if ( ! wc.isDestroyed() ) {
					wc.reload();
				}
			}, 10_000 );
		}
	} );

	wc.on( 'render-process-gone', () => {
		if ( ! wc.isDestroyed() ) {
			wc.reload();
		}
	} );

	wc.loadURL( type.url );
	return state;
}

function runCustomJs( state: ServiceState ): void {
	const wc = state.view.webContents;
	if ( wc.isDestroyed() || ! state.config.js.trim() ) {
		return;
	}
	wc.executeJavaScript( state.config.js, true ).catch( ( error ) => {
		console.error( `Custom JS failed: ${ state.config.name }`, error );
	} );
}

const configuredPartitions = new Set< string >();

function setupSession( partition: string ): void {
	if ( configuredPartitions.has( partition ) ) {
		return;
	}
	configuredPartitions.add( partition );
	const ses = session.fromPartition( partition );
	ses.setUserAgent( app.userAgentFallback );
	// Notifications are denied: unread counts are shown as badges instead (see preload/service.ts)
	const allowed = new Set( [ 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen' ] );
	ses.setPermissionRequestHandler( ( _wc, permission, callback ) => {
		callback( allowed.has( permission ) );
	} );
	ses.setPermissionCheckHandler( ( _wc, permission ) => allowed.has( permission ) );
}

/**
 * Switch the UA when a page has finished navigating to or away from the sign-in host.
 * Switching during a navigation or redirect cancels it, which breaks redirect chains such as SAML.
 */
function handleSignInUserAgent( wc: WebContents ): void {
	wc.on( 'did-navigate', ( _event, url ) => {
		const userAgent =
			hostnameOf( url ) === SIGN_IN_HOST ? SIGN_IN_USER_AGENT : app.userAgentFallback;
		if ( wc.getUserAgent() !== userAgent ) {
			wc.setUserAgent( userAgent );
		}
	} );
	// Sign-in popups opened from the service
	wc.on( 'did-create-window', ( child ) => handleSignInUserAgent( child.webContents ) );
}

function hostnameOf( url: string ): string | undefined {
	try {
		return new URL( url ).hostname;
	} catch {
		return undefined;
	}
}

function isInternalUrl( url: string, type: ServiceType ): boolean {
	try {
		const { hostname } = new URL( url );
		const serviceHost = new URL( type.url ).hostname;
		return (
			url === 'about:blank' ||
			hostname === serviceHost ||
			hostname === SIGN_IN_HOST
		);
	} catch {
		return false;
	}
}

function openExternal( url: string ): void {
	if ( /^https?:\/\//.test( url ) ) {
		shell.openExternal( url );
	}
}

/** Bounds of the area right of the sidebar, where the service views are shown */
function getContentBounds(): Rectangle {
	const { width, height } = win!.getContentBounds();
	const top = TITLEBAR_HEIGHT + TOP_BORDER;
	return {
		x: SIDEBAR_WIDTH,
		y: top,
		width: Math.max( 0, width - SIDEBAR_WIDTH ),
		height: Math.max( 0, height - top ),
	};
}

function layout(): void {
	if ( ! win ) {
		return;
	}
	const { width } = win.getContentBounds();
	titlebar?.setBounds( { x: 0, y: 0, width, height: TITLEBAR_HEIGHT } );
	const contentBounds = getContentBounds();
	sidebar.setBounds( { x: 0, y: contentBounds.y, width: SIDEBAR_WIDTH, height: contentBounds.height } );
	emptyView.setBounds( contentBounds );
	for ( const { view } of states ) {
		view.setBounds( contentBounds );
	}
}

function updateEmptyState(): void {
	emptyView?.setVisible( states.length === 0 );
}

function findState( id: string ): ServiceState | undefined {
	return states.find( ( state ) => state.config.id === id );
}

function activate( id: string ): void {
	const target = findState( id );
	if ( ! target ) {
		return;
	}
	activeId = id;
	for ( const state of states ) {
		state.view.setVisible( state === target );
	}
	target.view.webContents.focus();
	settings.activeServiceId = id;
	saveSettings( settings );
	pushSidebarState();
}

function persistServices(): void {
	settings.services = states.map( ( state ) => state.config );
	saveSettings( settings );
	updateEmptyState();
	pushSidebarState();
}

function addService( type: ServiceType ): void {
	const sameType = states.filter( ( state ) => state.config.type === type.type ).length;
	const config: ServiceConfig = {
		id: `${ type.type }-${ randomUUID() }`,
		type: type.type,
		name: sameType > 0 ? `${ type.label } ${ sameType + 1 }` : type.label,
		badge: true,
		js: '',
		pollInterval: type.defaultPollInterval ?? 0,
	};
	createServiceView( config );
	layout();
	persistServices();
	activate( config.id );
}

async function removeService( id: string ): Promise< void > {
	const state = findState( id );
	if ( ! state || ! win ) {
		return;
	}
	const { response } = await dialog.showMessageBox( win, {
		type: 'warning',
		buttons: [ 'Remove', 'Cancel' ],
		defaultId: 1,
		cancelId: 1,
		message: `Remove "${ state.config.name }"?`,
		detail: 'Its login session and settings will also be deleted.',
	} );
	if ( response !== 0 ) {
		return;
	}
	destroyService( state );

	if ( activeId === id ) {
		activeId = undefined;
		if ( states[ 0 ] ) {
			activate( states[ 0 ].config.id );
		}
	}
	persistServices();
	updateBadges();
}

/** Remove a service's view and delete its login session */
function destroyService( state: ServiceState ): void {
	stopPolling( state );
	states.splice( states.indexOf( state ), 1 );
	win?.contentView.removeChildView( state.view );
	const ses = state.view.webContents.session;
	state.view.webContents.close();
	ses.clearStorageData().catch( () => {} );
}

async function exportServices(): Promise< void > {
	if ( ! win ) {
		return;
	}
	const { canceled, filePath } = await dialog.showSaveDialog( win, {
		title: 'Export Settings',
		defaultPath: join( app.getPath( 'documents' ), 'tuttibox-settings.json' ),
		filters: [ { name: 'Tuttibox Settings', extensions: [ 'json' ] } ],
	} );
	if ( canceled || ! filePath ) {
		return;
	}
	try {
		await writeFile( filePath, serializeServices( states.map( ( state ) => state.config ) ) );
	} catch ( error ) {
		dialog.showErrorBox( 'Export Failed', String( error ) );
	}
}

async function importServices(): Promise< void > {
	if ( ! win ) {
		return;
	}
	const { canceled, filePaths } = await dialog.showOpenDialog( win, {
		title: 'Import Settings',
		properties: [ 'openFile' ],
		filters: [ { name: 'Tuttibox Settings', extensions: [ 'json' ] } ],
	} );
	if ( canceled || ! filePaths[ 0 ] ) {
		return;
	}

	let imported: ServiceConfig[];
	let skipped: number;
	try {
		( { services: imported, skipped } = parseServices( await readFile( filePaths[ 0 ], 'utf8' ) ) );
	} catch ( error ) {
		dialog.showErrorBox( 'Import Failed', error instanceof Error ? error.message : String( error ) );
		return;
	}
	if ( imported.length === 0 ) {
		dialog.showErrorBox( 'Import Failed', 'The file contains no supported apps.' );
		return;
	}

	const details = [ `${ imported.length } app(s): ${ imported.map( ( config ) => config.name ).join( ', ' ) }` ];
	if ( skipped > 0 ) {
		details.push( `${ skipped } unsupported app(s) will be skipped.` );
	}
	if ( imported.some( ( config ) => config.js.trim() ) ) {
		details.push( 'Some apps include custom JavaScript. Only import files you trust.' );
	}
	// Login sessions are not exported, so each imported app needs signing in again
	details.push( 'You will need to sign in to each imported app.' );

	if ( states.length > 0 ) {
		details.push( 'Your current apps will be replaced and their login sessions deleted.' );
	}
	const { response } = await dialog.showMessageBox( win, {
		type: 'question',
		buttons: [ 'Import', 'Cancel' ],
		defaultId: 0,
		cancelId: 1,
		message: 'Import apps from this file?',
		detail: details.join( '\n\n' ),
	} );
	if ( response !== 0 ) {
		return;
	}

	for ( const state of [ ...states ] ) {
		destroyService( state );
	}
	activeId = undefined;
	for ( const config of imported ) {
		createServiceView( config );
	}
	layout();
	persistServices();
	activate( imported[ 0 ].id );
	updateBadges();
}

function reorderServices( ids: string[] ): void {
	const ordered = ids
		.map( ( id ) => findState( id ) )
		.filter( ( state ): state is ServiceState => !! state );
	// Keep any services missing from the received IDs at the end, in their original order
	for ( const state of states ) {
		if ( ! ordered.includes( state ) ) {
			ordered.push( state );
		}
	}
	states.splice( 0, states.length, ...ordered );
	persistServices();
}

function openEditWindow( id: string ): void {
	const state = findState( id );
	if ( ! state || ! win ) {
		return;
	}
	const editWin = new BrowserWindow( {
		parent: win,
		modal: true,
		width: 560,
		height: 640,
		minWidth: 420,
		minHeight: 480,
		title: `Edit ${ state.config.name }`,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join( __dirname, '../preload/edit.js' ),
			sandbox: true,
			contextIsolation: true,
		},
	} );
	const wcId = editWin.webContents.id;
	editWindows.set( wcId, id );
	editWin.on( 'closed', () => editWindows.delete( wcId ) );
	editWin.once( 'ready-to-show', () => editWin.show() );
	editWin.loadFile( join( __dirname, '../renderer/edit.html' ) );
}

function openSettingsWindow(): void {
	if ( ! win ) {
		return;
	}
	if ( settingsWindow ) {
		settingsWindow.focus();
		return;
	}
	settingsWindow = new BrowserWindow( {
		parent: win,
		modal: true,
		width: 480,
		height: 240,
		useContentSize: true,
		resizable: false,
		minimizable: false,
		maximizable: false,
		title: 'Settings',
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join( __dirname, '../preload/settings.js' ),
			sandbox: true,
			contextIsolation: true,
		},
	} );
	settingsWindow.on( 'closed', () => {
		settingsWindow = null;
	} );
	settingsWindow.once( 'ready-to-show', () => settingsWindow?.show() );
	settingsWindow.loadFile( join( __dirname, '../renderer/settings.html' ) );
}

function getOpenAtLogin(): boolean {
	return supportsOpenAtLogin && app.getLoginItemSettings().openAtLogin;
}

function showWindow(): void {
	if ( ! win ) {
		createWindow();
		return;
	}
	if ( win.isMinimized() ) {
		win.restore();
	}
	win.show();
	win.focus();
}

function createTray(): void {
	// macOS keeps the app in the Dock, so the tray is only needed on Windows / Linux
	if ( isMac ) {
		return;
	}
	// Pre-rendered at each size (an ICO on Windows, PNG with @1.25x / @1.5x / @2x variants
	// elsewhere) so the icon stays crisp instead of shrinking the large app icon
	tray = new Tray( trayIconPath( false ) );
	tray.setToolTip( 'Tuttibox' );
	tray.setContextMenu(
		Menu.buildFromTemplate( [
			{ label: 'Show Tuttibox', click: showWindow },
			{ type: 'separator' },
			{ label: 'Quit', click: () => app.quit() },
		] )
	);
	tray.on( 'click', showWindow );
}

/** Tray icon with a red dot in the corner while any service has unread items */
function trayIconPath( unread: boolean ): string {
	// Windows draws semi-transparent pixels of PNG tray icons too dark, which leaves grey
	// smudges around the rounded corners. ICO files (one image per size) are drawn correctly
	const ext = process.platform === 'win32' ? 'ico' : 'png';
	return join( __dirname, `../assets/${ unread ? 'tray-unread' : 'tray' }.${ ext }` );
}

let trayUnread = false;

function updateTrayIcon( total: number ): void {
	const unread = total > 0;
	if ( ! tray || unread === trayUnread ) {
		return;
	}
	trayUnread = unread;
	tray.setImage( trayIconPath( unread ) );
	tray.setToolTip( unread ? `Tuttibox (${ total } unread)` : 'Tuttibox' );
}

function setUnread( state: ServiceState, unread: number ): void {
	if ( unread !== state.unread ) {
		state.unread = unread;
		updateBadges();
	}
}

/** Read the unread count from the page now, in case the title change was missed */
async function pollService( state: ServiceState ): Promise< void > {
	const { parseBadge, pollScript } = state.type;
	const wc = state.view.webContents;
	if ( ! parseBadge || wc.isDestroyed() || wc.isLoading() ) {
		return;
	}
	try {
		const result: unknown = await wc.executeJavaScript( pollScript ?? 'document.title' );
		if ( states.includes( state ) ) {
			setUnread( state, parseBadge( String( result ?? '' ) ) );
		}
	} catch {
		// The page navigated away or the script failed; try again on the next check
	}
}

/** (Re)start the service's periodic unread count check from its config */
function startPolling( state: ServiceState ): void {
	stopPolling( state );
	if ( state.type.parseBadge && state.config.pollInterval > 0 ) {
		state.pollTimer = setInterval( () => void pollService( state ), state.config.pollInterval * 1000 );
	}
}

function stopPolling( state: ServiceState ): void {
	if ( state.pollTimer ) {
		clearInterval( state.pollTimer );
		state.pollTimer = undefined;
	}
}

function badgeOf( state: ServiceState ): number {
	return state.config.badge ? state.unread : 0;
}

function pushSidebarState(): void {
	if ( ! sidebar || sidebar.webContents.isDestroyed() ) {
		return;
	}
	const items: SidebarItem[] = states.map( ( state ) => ( {
		id: state.config.id,
		name: state.config.name,
		color: state.type.color,
		icon: state.icon,
		badge: badgeOf( state ),
		active: state.config.id === activeId,
	} ) );
	sidebar.webContents.send( 'sidebar:state', items );
}

function updateBadges(): void {
	pushSidebarState();
	const total = states.reduce( ( sum, state ) => sum + badgeOf( state ), 0 );
	if ( isMac ) {
		app.setBadgeCount( total );
	}
	// On Windows, the sidebar draws the overlay icon and sends it via `badge:overlay`
	updateTrayIcon( total );
}

ipcMain.on( 'sidebar:select', ( _event, id: string ) => {
	activate( id );
	const state = findState( id );
	if ( state ) {
		void pollService( state );
	}
} );

ipcMain.on( 'sidebar:reorder', ( _event, ids: string[] ) => reorderServices( ids ) );

ipcMain.on( 'sidebar:add-menu', () => {
	Menu.buildFromTemplate(
		serviceTypes.map( ( type ) => ( {
			label: type.label,
			click: () => addService( type ),
		} ) )
	).popup();
} );

ipcMain.on( 'sidebar:open-settings', openSettingsWindow );

ipcMain.handle( 'settings:get', (): AppSettingsData => ( {
	openAtLogin: getOpenAtLogin(),
	supportsOpenAtLogin,
} ) );

ipcMain.handle( 'settings:set-open-at-login', ( _event, enabled: boolean ): boolean => {
	if ( supportsOpenAtLogin ) {
		app.setLoginItemSettings( { openAtLogin: enabled } );
	}
	return getOpenAtLogin();
} );

ipcMain.on( 'settings:close', () => settingsWindow?.close() );

ipcMain.on( 'sidebar:context-menu', ( _event, id: string ) => {
	const state = findState( id );
	if ( ! state ) {
		return;
	}
	Menu.buildFromTemplate( [
		{ label: 'Reload', click: () => state.view.webContents.reload() },
		{ label: 'Edit…', click: () => openEditWindow( id ) },
		{ type: 'separator' },
		{ label: 'Remove…', click: () => removeService( id ) },
	] ).popup();
} );

ipcMain.handle( 'edit:get', ( event ): EditData | null => {
	const id = editWindows.get( event.sender.id );
	const state = id ? findState( id ) : undefined;
	if ( ! state ) {
		return null;
	}
	return {
		name: state.config.name,
		badge: state.config.badge,
		js: state.config.js,
		pollInterval: state.config.pollInterval,
		pollIntervals: POLL_INTERVALS,
		typeLabel: state.type.label,
		supportsBadge: !! state.type.parseBadge,
	};
} );

ipcMain.on( 'edit:save', ( event, data: Pick< EditData, 'name' | 'badge' | 'js' | 'pollInterval' > ) => {
	const id = editWindows.get( event.sender.id );
	const state = id ? findState( id ) : undefined;
	if ( state ) {
		const jsChanged = state.config.js !== data.js;
		state.config.name = data.name.trim() || state.type.label;
		state.config.badge = data.badge;
		state.config.js = data.js;
		state.config.pollInterval = normalizePollInterval( data.pollInterval, state.config.pollInterval );
		startPolling( state );
		persistServices();
		updateBadges();
		// Already-executed JS cannot be undone, so reload the page when it changes
		if ( jsChanged ) {
			state.view.webContents.reload();
		}
	}
	BrowserWindow.fromWebContents( event.sender )?.close();
} );

ipcMain.on( 'edit:cancel', ( event ) => {
	BrowserWindow.fromWebContents( event.sender )?.close();
} );

ipcMain.on( 'badge:overlay', ( _event, dataUrl: string | null, total: number ) => {
	if ( process.platform !== 'win32' || ! win ) {
		return;
	}
	if ( ! dataUrl || total === 0 ) {
		win.setOverlayIcon( null, '' );
		return;
	}
	win.setOverlayIcon( nativeImage.createFromDataURL( dataUrl ), `${ total } unread` );
} );

function persistWindow(): void {
	if ( ! win ) {
		return;
	}
	settings.maximized = win.isMaximized();
	if ( ! settings.maximized ) {
		settings.bounds = win.getBounds();
	}
	saveSettings( settings );
}

function buildMenu(): void {
	const activeWebContents = () => ( activeId ? findState( activeId )?.view.webContents : undefined );

	const template: MenuItemConstructorOptions[] = [
		...( isMac ? [ { role: 'appMenu' } as MenuItemConstructorOptions ] : [] ),
		{
			label: 'File',
			submenu: [
				{
					label: 'Add Service',
					submenu: serviceTypes.map( ( type ) => ( { label: type.label, click: () => addService( type ) } ) ),
				},
				{ type: 'separator' },
				{ label: 'Import Settings…', click: () => importServices() },
				{ label: 'Export Settings…', click: () => exportServices() },
				{ type: 'separator' },
				{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
				{ label: 'Check for Updates…', click: () => checkForUpdatesFromMenu() },
				{ type: 'separator' },
				isMac ? { role: 'close', label: 'Close Window' } : { label: 'Quit Tuttibox', accelerator: 'Ctrl+Q', click: () => app.quit() },
			],
		},
		// Without this menu, Cmd+C / Cmd+V do not work on macOS
		{ role: 'editMenu', label: 'Edit' },
		{
			label: 'View',
			submenu: [
				{ label: 'Reload', click: () => activeWebContents()?.reload() },
				{ label: 'Back', click: () => activeWebContents()?.navigationHistory.goBack() },
				{ label: 'Forward', click: () => activeWebContents()?.navigationHistory.goForward() },
				{ type: 'separator' },
				{ label: 'Zoom In', click: () => zoom( 0.5 ) },
				{ label: 'Zoom Out', click: () => zoom( -0.5 ) },
				{ label: 'Actual Size', click: () => activeWebContents()?.setZoomLevel( 0 ) },
				{ type: 'separator' },
				{ label: 'Developer Tools', click: () => activeWebContents()?.toggleDevTools() },
			],
		},
		{ role: 'windowMenu', label: 'Window' },
	];
	Menu.setApplicationMenu( Menu.buildFromTemplate( template ) );
	pushTitlebarMenus();

	function zoom( delta: number ): void {
		const wc = activeWebContents();
		if ( wc ) {
			wc.setZoomLevel( wc.getZoomLevel() + delta );
		}
	}
}

function pushTitlebarMenus(): void {
	const menu = Menu.getApplicationMenu();
	if ( ! titlebar || titlebar.webContents.isDestroyed() || ! menu ) {
		return;
	}
	titlebar.webContents.send(
		'titlebar:menus',
		menu.items.map( ( item ) => item.label )
	);
}

ipcMain.on( 'titlebar:open-menu', ( event, index: number, x: number, y: number ) => {
	const submenu = Menu.getApplicationMenu()?.items[ index ]?.submenu;
	if ( ! submenu || ! win ) {
		return;
	}
	// The title bar view sits at the top-left of the window, so its coordinates match the window's
	submenu.popup( {
		window: win,
		x,
		y,
		callback: () => {
			if ( ! event.sender.isDestroyed() ) {
				event.sender.send( 'titlebar:menu-closed' );
			}
		},
	} );
} );

app.on( 'second-instance', showWindow );
app.on( 'activate', showWindow );
app.on( 'before-quit', () => {
	quitting = true;
} );
app.on( 'window-all-closed', () => {
	if ( ! isMac ) {
		app.quit();
	}
} );

app.whenReady().then( () => {
	if ( ! gotLock ) {
		return;
	}
	if ( process.platform === 'win32' ) {
		// Must match the appId so the taskbar groups the window with the installed shortcut.
		// Use a separate ID in development: otherwise a Start Menu shortcut to electron.exe
		// with the release ID can be created, and the taskbar then shows the Electron icon for the release app.
		app.setAppUserModelId( app.isPackaged ? 'com.t-hamano.tuttibox' : 'com.t-hamano.tuttibox.dev' );
	}
	createWindow();
	buildMenu();
	createTray();
	setupAutoUpdate( () => {
		// The window would otherwise hide itself instead of closing and block the install
		quitting = true;
	} );
} );
