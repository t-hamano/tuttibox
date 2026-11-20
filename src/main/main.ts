import {
	app,
	BaseWindow,
	Menu,
	WebContentsView,
	clipboard,
	ipcMain,
	nativeImage,
	session,
	shell,
	type MenuItemConstructorOptions,
	type WebContents,
} from 'electron';
import { join } from 'node:path';
import { CssInjector } from './css';
import { services, type ServiceDefinition } from './services';
import { loadSettings, saveSettings } from './settings';

const SIDEBAR_WIDTH = 64;
const isMac = process.platform === 'darwin';

interface ServiceState {
	definition: ServiceDefinition;
	view: WebContentsView;
	badge: number;
	icon?: string;
}

/** サイドバーへ送る表示用データ */
export interface SidebarItem {
	id: string;
	name: string;
	color: string;
	icon?: string;
	badge: number;
	active: boolean;
}

// Electron/アプリ名を含む UA だと Google ログインが拒否されるため、通常の Chrome UA にする
app.userAgentFallback = app.userAgentFallback
	.replace( /\sElectron\/\S+/, '' )
	.replace( new RegExp( `\\s${ app.getName() }/\\S+`, 'i' ), '' );

const gotLock = app.requestSingleInstanceLock();
if ( ! gotLock ) {
	app.quit();
}

let win: BaseWindow | null = null;
let sidebar: WebContentsView;
let cssInjector: CssInjector;
const states = new Map< string, ServiceState >();
let activeId = services[ 0 ].id;
let quitting = false;
const settings = loadSettings();

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
		backgroundColor: '#1e1e1e',
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

	cssInjector = new CssInjector( services );
	for ( const definition of services ) {
		createServiceView( definition );
	}

	if ( settings.activeServiceId && states.has( settings.activeServiceId ) ) {
		activeId = settings.activeServiceId;
	}
	activate( activeId );

	win.on( 'resize', layout );
	win.on( 'close', ( event ) => {
		persistWindow();
		// macOS ではウィンドウを閉じてもアプリは常駐させる
		if ( isMac && ! quitting ) {
			event.preventDefault();
			win?.hide();
		}
	} );
	win.on( 'closed', () => {
		win = null;
	} );
	layout();
}

function createServiceView( definition: ServiceDefinition ): void {
	const partition = `persist:${ definition.id }`;
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

	const state: ServiceState = { definition, view, badge: 0 };
	states.set( definition.id, state );

	const wc = view.webContents;
	cssInjector.register( definition.id, wc );

	wc.on( 'page-title-updated', ( _event, title ) => {
		if ( ! definition.parseBadge ) {
			return;
		}
		const badge = definition.parseBadge( title );
		if ( badge !== state.badge ) {
			state.badge = badge;
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
		// Google ログインや同一サービス内のポップアップはアプリ内で開く
		if ( isInternalUrl( url, definition ) ) {
			return { action: 'allow' };
		}
		openExternal( url );
		return { action: 'deny' };
	} );

	wc.on( 'context-menu', ( _event, params ) => {
		const template: MenuItemConstructorOptions[] = [];
		if ( params.linkURL ) {
			template.push(
				{ label: 'リンクをブラウザで開く', click: () => openExternal( params.linkURL ) },
				{ label: 'リンクをコピー', click: () => clipboard.writeText( params.linkURL ) },
				{ type: 'separator' }
			);
		}
		if ( params.isEditable ) {
			template.push( { role: 'cut', label: '切り取り' } );
		}
		template.push( { role: 'copy', label: 'コピー', enabled: params.selectionText.length > 0 || params.isEditable } );
		if ( params.isEditable ) {
			template.push( { role: 'paste', label: '貼り付け' } );
		}
		template.push(
			{ role: 'selectAll', label: 'すべて選択' },
			{ type: 'separator' },
			{ label: '戻る', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
			{ label: '再読み込み', click: () => wc.reload() }
		);
		Menu.buildFromTemplate( template ).popup();
	} );

	// 通信断などで読み込みに失敗したら少し待って再試行する
	wc.on( 'did-fail-load', ( _event, errorCode, _desc, _url, isMainFrame ) => {
		// -3 は ERR_ABORTED (ユーザー操作によるキャンセル)
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

	wc.loadURL( definition.url );
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

function isInternalUrl( url: string, definition: ServiceDefinition ): boolean {
	try {
		const { hostname } = new URL( url );
		const serviceHost = new URL( definition.url ).hostname;
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
	sidebar.setBounds( { x: 0, y: 0, width: SIDEBAR_WIDTH, height } );
	for ( const { view } of states.values() ) {
		view.setBounds( {
			x: SIDEBAR_WIDTH,
			y: 0,
			width: Math.max( 0, width - SIDEBAR_WIDTH ),
			height,
		} );
	}
}

function activate( id: string ): void {
	const target = states.get( id );
	if ( ! target ) {
		return;
	}
	activeId = id;
	for ( const state of states.values() ) {
		state.view.setVisible( state === target );
	}
	target.view.webContents.focus();
	settings.activeServiceId = id;
	saveSettings( settings );
	pushSidebarState();
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

function pushSidebarState(): void {
	if ( ! sidebar || sidebar.webContents.isDestroyed() ) {
		return;
	}
	const items: SidebarItem[] = [ ...states.values() ].map( ( state ) => ( {
		id: state.definition.id,
		name: state.definition.name,
		color: state.definition.color,
		icon: state.icon,
		badge: state.badge,
		active: state.definition.id === activeId,
	} ) );
	sidebar.webContents.send( 'sidebar:state', items );
}

function totalBadge(): number {
	let total = 0;
	for ( const state of states.values() ) {
		total += state.badge;
	}
	return total;
}

function updateBadges(): void {
	pushSidebarState();
	const total = totalBadge();
	if ( isMac ) {
		app.setBadgeCount( total );
	}
	// Windows のオーバーレイアイコンはサイドバー側で画像を生成して `badge:overlay` で受け取る
}

ipcMain.on( 'sidebar:select', ( _event, id: string ) => activate( id ) );

ipcMain.on( 'badge:overlay', ( _event, dataUrl: string | null, total: number ) => {
	if ( process.platform !== 'win32' || ! win ) {
		return;
	}
	if ( ! dataUrl || total === 0 ) {
		win.setOverlayIcon( null, '' );
		return;
	}
	win.setOverlayIcon( nativeImage.createFromDataURL( dataUrl ), `未読 ${ total } 件` );
} );

ipcMain.on( 'service:notification-click', ( event ) => {
	const state = findStateByWebContents( event.sender );
	showWindow();
	if ( state ) {
		activate( state.definition.id );
	}
} );

function findStateByWebContents( wc: WebContents ): ServiceState | undefined {
	for ( const state of states.values() ) {
		if ( state.view.webContents === wc ) {
			return state;
		}
	}
	return undefined;
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
	const serviceItems: MenuItemConstructorOptions[] = services.map( ( service, index ) => ( {
		label: service.name,
		accelerator: `CmdOrCtrl+${ index + 1 }`,
		click: () => activate( service.id ),
	} ) );

	const activeWebContents = () => states.get( activeId )?.view.webContents;

	const template: MenuItemConstructorOptions[] = [
		...( isMac ? [ { role: 'appMenu' } as MenuItemConstructorOptions ] : [] ),
		{
			label: 'ファイル',
			submenu: [
				{ label: 'CSS フォルダを開く', click: () => shell.openPath( cssInjector.dir ) },
				{ label: 'CSS を再適用', click: () => cssInjector.reloadAll() },
				{ type: 'separator' },
				isMac ? { role: 'close', label: 'ウィンドウを閉じる' } : { role: 'quit', label: '終了' },
			],
		},
		// macOS ではこのメニューが無いと Cmd+C / Cmd+V が効かない
		{ role: 'editMenu', label: '編集' },
		{
			label: '表示',
			submenu: [
				{ label: '再読み込み', accelerator: 'CmdOrCtrl+R', click: () => activeWebContents()?.reload() },
				{ label: '戻る', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => activeWebContents()?.navigationHistory.goBack() },
				{ label: '進む', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => activeWebContents()?.navigationHistory.goForward() },
				{ type: 'separator' },
				{ label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: () => zoom( 0.5 ) },
				{ label: '縮小', accelerator: 'CmdOrCtrl+-', click: () => zoom( -0.5 ) },
				{ label: '実寸', accelerator: 'CmdOrCtrl+0', click: () => activeWebContents()?.setZoomLevel( 0 ) },
				{ type: 'separator' },
				{ label: '開発者ツール', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => activeWebContents()?.toggleDevTools() },
			],
		},
		{ label: 'サービス', submenu: serviceItems },
		{ role: 'windowMenu', label: 'ウィンドウ' },
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
		// Windows の通知に必要
		app.setAppUserModelId( 'com.t-hamano.tuttibox' );
	}
	buildMenu();
	createWindow();
} );
