import { contextBridge } from 'electron';

/**
 * Preload for each service page.
 * Tuttibox shows unread counts as badges and does not show desktop notifications.
 * The main process denies the notification permission so nothing reaches the OS,
 * and here the page sees notifications as granted and silently dropped,
 * so services do not keep asking the user to enable notifications.
 */
contextBridge.executeInMainWorld( {
	func: () => {
		if ( ! window.Notification ) {
			return;
		}

		class SilentNotification extends EventTarget {
			static readonly permission: NotificationPermission = 'granted';
			static readonly maxActions = 0;
			static requestPermission(
				callback?: NotificationPermissionCallback
			): Promise< NotificationPermission > {
				callback?.( 'granted' );
				return Promise.resolve( 'granted' );
			}

			readonly title: string;
			readonly body: string;
			readonly tag: string;
			readonly icon: string;
			readonly data: unknown;
			onclick: ( ( event: Event ) => void ) | null = null;
			onshow: ( ( event: Event ) => void ) | null = null;
			onclose: ( ( event: Event ) => void ) | null = null;
			onerror: ( ( event: Event ) => void ) | null = null;

			constructor( title: string, options: NotificationOptions = {} ) {
				super();
				this.title = title;
				this.body = options.body ?? '';
				this.tag = options.tag ?? '';
				this.icon = options.icon ?? '';
				this.data = options.data ?? null;
			}

			close(): void {}
		}
		window.Notification = SilentNotification as unknown as typeof Notification;

		if ( window.ServiceWorkerRegistration ) {
			const proto = ServiceWorkerRegistration.prototype;
			proto.showNotification = () => Promise.resolve();
			proto.getNotifications = () => Promise.resolve( [] );
		}
	},
} );

/**
 * Hidden service views draw no frames, so `requestAnimationFrame` callbacks never run there.
 * Some services (e.g. Slack) wait for the next frame to update the page, so their unread
 * badges stayed stale until the service was shown. When no frame comes within a second,
 * run the callback from a timer instead. Shown pages get their frames first, as usual.
 */
contextBridge.executeInMainWorld( {
	func: () => {
		const FALLBACK_DELAY = 1000;
		const nativeRequest = window.requestAnimationFrame.bind( window );
		const nativeCancel = window.cancelAnimationFrame.bind( window );
		const pending = new Map< number, { frame: number; timer: ReturnType< typeof setTimeout > } >();
		let nextId = 1;

		window.requestAnimationFrame = ( callback: FrameRequestCallback ): number => {
			const id = nextId++;
			const run = ( time: number ) => {
				const entry = pending.get( id );
				if ( ! entry ) {
					return;
				}
				pending.delete( id );
				nativeCancel( entry.frame );
				clearTimeout( entry.timer );
				callback( time );
			};
			pending.set( id, {
				frame: nativeRequest( run ),
				timer: setTimeout( () => run( performance.now() ), FALLBACK_DELAY ),
			} );
			return id;
		};

		window.cancelAnimationFrame = ( id: number ): void => {
			const entry = pending.get( id );
			if ( entry ) {
				pending.delete( id );
				nativeCancel( entry.frame );
				clearTimeout( entry.timer );
			}
		};
	},
} );

/**
 * Google sign-in blocks embedded Chromium, so on the sign-in host present the page as Firefox.
 * The main process rewrites the request headers to match.
 */
const signInUserAgent = process.argv
	.find( ( arg ) => arg.startsWith( '--tuttibox-sign-in-ua=' ) )
	?.slice( '--tuttibox-sign-in-ua='.length );
if ( signInUserAgent && location.hostname === 'accounts.google.com' ) {
	contextBridge.executeInMainWorld( {
		func: ( userAgent: string ) => {
			const proto = Navigator.prototype as unknown as Record< string, unknown >;
			const define = ( name: string, value: string ) =>
				Object.defineProperty( proto, name, { get: () => value, configurable: true } );
			define( 'userAgent', userAgent );
			define( 'appVersion', userAgent.replace( /^Mozilla\//, '' ).replace( /\).*$/, ')' ) );
			define( 'vendor', '' );
			// Firefox has no User-Agent Client Hints API
			delete proto.userAgentData;
		},
		args: [ signInUserAgent ],
	} );
}
