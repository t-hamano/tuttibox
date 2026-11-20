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
	type MenuItemConstructorOptions,
	type WebContents,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { findServiceType, serviceTypes, type ServiceType } from './services';
import { loadSettings, saveSettings, type ServiceConfig } from './settings';

const SIDEBAR_WIDTH = 64;
/** ウィンドウ上端の境界線の太さ。ビューをこの分だけ下げ、隙間にウィンドウ背景色を見せて線にする */
const TOP_BORDER = 1;
const BORDER_COLOR = '#d9d9de';
const isMac = process.platform === 'darwin';

interface ServiceState {
	config: ServiceConfig;
	type: ServiceType;
	view: WebContentsView;
	/** タイトルから読み取った未読数 (バッジ無効でも保持する) */
	unread: number;
	icon?: string;
	cssKey?: string;
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

/** 編集画面とやりとりするデータ */
export interface EditData {
	name: string;
	badge: boolean;
	css: string;
	js: string;
	typeLabel: string;
	supportsBadge: boolean;
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
/** サイドバーの表示順 */
const states: ServiceState[] = [];
let activeId: string | undefined;
let quitting = false;
const settings = loadSettings();
/** 編集ウィンドウの webContents.id → サービス ID */
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

	for ( const config of settings.services ) {
		createServiceView( config );
	}

	const initial =
		states.find( ( state ) => state.config.id === settings.activeServiceId ) ?? states[ 0 ];
	if ( initial ) {
		activate( initial.config.id );
	}

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
		state.cssKey = undefined;
		applyCss( state );
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
		// Google ログインや同一サービス内のポップアップはアプリ内で開く
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

	wc.loadURL( type.url );
	return state;
}

async function applyCss( state: ServiceState ): Promise< void > {
	const wc = state.view.webContents;
	if ( wc.isDestroyed() ) {
		return;
	}
	if ( state.cssKey ) {
		await wc.removeInsertedCSS( state.cssKey ).catch( () => {} );
		state.cssKey = undefined;
	}
	if ( state.config.css.trim() ) {
		state.cssKey = await wc.insertCSS( state.config.css, { cssOrigin: 'user' } );
	}
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
	for ( const { view } of states ) {
		view.setBounds( {
			x: SIDEBAR_WIDTH,
			y: TOP_BORDER,
			width: Math.max( 0, width - SIDEBAR_WIDTH ),
			height: contentHeight,
		} );
	}
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
	buildMenu();
	pushSidebarState();
}

function addService( type: ServiceType ): void {
	const sameType = states.filter( ( state ) => state.config.type === type.type ).length;
	const config: ServiceConfig = {
		id: `${ type.type }-${ randomUUID() }`,
		type: type.type,
		name: sameType > 0 ? `${ type.label } ${ sameType + 1 }` : type.label,
		badge: true,
		css: '',
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
		buttons: [ '削除', 'キャンセル' ],
		defaultId: 1,
		cancelId: 1,
		message: `「${ state.config.name }」を削除しますか?`,
		detail: 'ログイン状態や設定も削除されます。',
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
	// 受け取った ID に漏れがあれば元の順で末尾に残す
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
		title: `${ state.config.name } の編集`,
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
	// Windows のオーバーレイアイコンはサイドバー側で画像を生成して `badge:overlay` で受け取る
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
		{ label: '再読み込み', click: () => state.view.webContents.reload() },
		{ label: '編集…', click: () => openEditWindow( id ) },
		{ type: 'separator' },
		{ label: '削除…', click: () => removeService( id ) },
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
		css: state.config.css,
		js: state.config.js,
		typeLabel: state.type.label,
		supportsBadge: !! state.type.parseBadge,
	};
} );

ipcMain.on( 'edit:save', ( event, data: Pick< EditData, 'name' | 'badge' | 'css' | 'js' > ) => {
	const id = editWindows.get( event.sender.id );
	const state = id ? findState( id ) : undefined;
	if ( state ) {
		const jsChanged = state.config.js !== data.js;
		state.config.name = data.name.trim() || state.type.label;
		state.config.badge = data.badge;
		state.config.css = data.css;
		state.config.js = data.js;
		persistServices();
		updateBadges();
		applyCss( state );
		// JS は実行済みの処理を取り消せないので、変更時はページを読み込み直す
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
	win.setOverlayIcon( nativeImage.createFromDataURL( dataUrl ), `未読 ${ total } 件` );
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
	const serviceItems: MenuItemConstructorOptions[] = states.map( ( state, index ) => ( {
		label: state.config.name,
		accelerator: index < 9 ? `CmdOrCtrl+${ index + 1 }` : undefined,
		click: () => activate( state.config.id ),
	} ) );

	const activeWebContents = () => ( activeId ? findState( activeId )?.view.webContents : undefined );

	const template: MenuItemConstructorOptions[] = [
		...( isMac ? [ { role: 'appMenu' } as MenuItemConstructorOptions ] : [] ),
		{
			label: 'ファイル',
			submenu: [
				{
					label: 'サービスを追加',
					submenu: serviceTypes.map( ( type ) => ( { label: type.label, click: () => addService( type ) } ) ),
				},
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
		{ label: 'サービス', submenu: serviceItems.length ? serviceItems : [ { label: '(なし)', enabled: false } ] },
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
	createWindow();
	buildMenu();
} );
