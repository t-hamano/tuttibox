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
	type WebContents,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { findServiceType, serviceTypes, type ServiceType } from './services';
import { loadSettings, saveSettings, type ServiceConfig } from './settings';

const SIDEBAR_WIDTH = 64;
/** Thickness of the top border. Views are shifted down by this amount so the window background shows through as a line */
const TOP_BORDER = 1;
const BORDER_COLOR = '#d9d9de';
const isMac = process.platform === 'darwin';

interface ServiceState {
	config: ServiceConfig;
	type: ServiceType;
	view: WebContentsView;
	/** Unread count read from the title (kept even when the badge is disabled) */
	unread: number;
	icon?: string;
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

/** Data exchanged with the edit window */
export interface EditData {
	name: string;
	badge: boolean;
	js: string;
	typeLabel: string;
	supportsBadge: boolean;
}

// Google rejects sign-in when the UA contains Electron or the app name, so use a plain Chrome UA
app.userAgentFallback = app.userAgentFallback
	.replace( /\sElectron\/\S+/, '' )
	.replace( new RegExp( `\\s${ app.getName() }/\\S+`, 'i' ), '' );

const gotLock = app.requestSingleInstanceLock();
if ( ! gotLock ) {
	app.quit();
}

let win: BaseWindow | null = null;
let sidebar: WebContentsView;
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

function createWindow(): void {
	win = new BaseWindow( {
		width: settings.bounds?.width ?? 1280,
		height: settings.bounds?.height ?? 800,
		x: settings.bounds?.x,
		y: settings.bounds?.y,
		minWidth: 600,
		minHeight: 400,
		title: 'Tuttibox',
		autoHideMenuBar: true,
		backgroundColor: BORDER_COLOR,
	} );
	if ( settings.maximized ) {
		win.maximize();
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
	view.setVisible( false );
	win!.contentView.addChildView( view );

	const state: ServiceState = { config, type, view, unread: 0 };
	states.push( state );

	const wc = view.webContents;

	wc.on( 'did-finish-load', () => {
		runCustomJs( state );
	} );

	wc.on( 'page-title-updated', ( _event, title ) => {
		if ( ! type.parseBadge ) {
			return;
		}
		const unread = type.parseBadge( title );
		if ( unread !== state.unread ) {
			state.unread = unread;
			updateBadges();
		}
	} );

	wc.on( 'page-favicon-updated', ( _event, favicons ) => {
		if ( favicons[ 0 ] && favicons[ 0 ] !== state.icon ) {
			state.icon = favicons[ 0 ];
			pushSidebarState();
		}
	} );

	wc.setWindowOpenHandler( ( { url } ) => {
		// Open Google sign-in and same-service popups inside the app
		if ( isInternalUrl( url, type ) ) {
			return { action: 'allow' };
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
	const allowed = new Set( [ 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen' ] );
	ses.setPermissionRequestHandler( ( _wc, permission, callback ) => {
		callback( allowed.has( permission ) );
	} );
	ses.setPermissionCheckHandler( ( _wc, permission ) => allowed.has( permission ) );
}

function isInternalUrl( url: string, type: ServiceType ): boolean {
	try {
		const { hostname } = new URL( url );
		const serviceHost = new URL( type.url ).hostname;
		return (
			url === 'about:blank' ||
			hostname === serviceHost ||
			hostname === 'accounts.google.com'
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

function layout(): void {
	if ( ! win ) {
		return;
	}
	const { width, height } = win.getContentBounds();
	const contentHeight = Math.max( 0, height - TOP_BORDER );
	sidebar.setBounds( { x: 0, y: TOP_BORDER, width: SIDEBAR_WIDTH, height: contentHeight } );
	const contentBounds = {
		x: SIDEBAR_WIDTH,
		y: TOP_BORDER,
		width: Math.max( 0, width - SIDEBAR_WIDTH ),
		height: contentHeight,
	};
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
	states.splice( states.indexOf( state ), 1 );
	win.contentView.removeChildView( state.view );
	const ses = state.view.webContents.session;
	state.view.webContents.close();
	ses.clearStorageData().catch( () => {} );

	if ( activeId === id ) {
		activeId = undefined;
		if ( states[ 0 ] ) {
			activate( states[ 0 ].config.id );
		}
	}
	persistServices();
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
	const icon = nativeImage
		.createFromPath( join( __dirname, '../assets/tray.png' ) )
		.resize( { width: 16, height: 16, quality: 'best' } );
	tray = new Tray( icon );
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
}

ipcMain.on( 'sidebar:select', ( _event, id: string ) => activate( id ) );

ipcMain.on( 'sidebar:reorder', ( _event, ids: string[] ) => reorderServices( ids ) );

ipcMain.on( 'sidebar:add-menu', () => {
	Menu.buildFromTemplate(
		serviceTypes.map( ( type ) => ( {
			label: type.label,
			click: () => addService( type ),
		} ) )
	).popup();
} );

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
		typeLabel: state.type.label,
		supportsBadge: !! state.type.parseBadge,
	};
} );

ipcMain.on( 'edit:save', ( event, data: Pick< EditData, 'name' | 'badge' | 'js' > ) => {
	const id = editWindows.get( event.sender.id );
	const state = id ? findState( id ) : undefined;
	if ( state ) {
		const jsChanged = state.config.js !== data.js;
		state.config.name = data.name.trim() || state.type.label;
		state.config.badge = data.badge;
		state.config.js = data.js;
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

ipcMain.on( 'service:notification-click', ( event ) => {
	const state = findStateByWebContents( event.sender );
	showWindow();
	if ( state ) {
		activate( state.config.id );
	}
} );

function findStateByWebContents( wc: WebContents ): ServiceState | undefined {
	return states.find( ( state ) => state.view.webContents === wc );
}

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
				isMac ? { role: 'close', label: 'Close Window' } : { role: 'quit', label: 'Quit' },
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

	function zoom( delta: number ): void {
		const wc = activeWebContents();
		if ( wc ) {
			wc.setZoomLevel( wc.getZoomLevel() + delta );
		}
	}
}

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
		// Required for notifications on Windows
		app.setAppUserModelId( 'com.t-hamano.tuttibox' );
	}
	createWindow();
	buildMenu();
	createTray();
} );
