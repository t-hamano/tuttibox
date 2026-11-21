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
