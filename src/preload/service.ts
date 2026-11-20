import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload for each service page.
 * When a web notification is clicked, bring the window to the front and switch to that service.
 */
contextBridge.exposeInMainWorld( '__tuttibox', {
	notificationClicked: () => ipcRenderer.send( 'service:notification-click' ),
} );

contextBridge.executeInMainWorld( {
	func: () => {
		const Original = window.Notification;
		if ( ! Original ) {
			return;
		}
		const bridge = ( window as unknown as {
			__tuttibox: { notificationClicked: () => void };
		} ).__tuttibox;

		class TuttiboxNotification extends Original {
			constructor( title: string, options?: NotificationOptions ) {
				super( title, options );
				this.addEventListener( 'click', () => bridge.notificationClicked() );
			}
		}
		window.Notification = TuttiboxNotification;
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
