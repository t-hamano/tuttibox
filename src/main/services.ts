/** A kind of service that can be added */
export interface ServiceType {
	type: string;
	/** Default display name */
	label: string;
	url: string;
	/** Background color of the initial letter shown until the favicon loads */
	color: string;
	/**
	 * Extract the unread count from the page title.
	 * Omit for services that do not show an unread count.
	 */
	parseBadge?: ( title: string ) => number;
	/**
	 * JavaScript expression run in the page on each check. Its result is passed to `parseBadge`.
	 * Defaults to the page title.
	 */
	pollScript?: string;
	/**
	 * Check interval in seconds for newly added services of this type.
	 * Set this when the count can change without the page title changing.
	 */
	defaultPollInterval?: number;
	/**
	 * Fixed icon URL to use instead of the page's favicon.
	 * Set this when the service draws the unread count into its favicon,
	 * so the count is not shown twice next to the sidebar badge.
	 */
	icon?: string;
}

/** Treat the first "(number)" in the title as the unread count */
function countInParentheses( title: string ): number {
	const match = title.match( /\((\d+)\)/ );
	return match ? Number( match[ 1 ] ) : 0;
}

/**
 * Read Slack's mention and DM count from the page, as Slack shows it only there.
 * Prefers the badge on the Activity button, which is Slack's own total.
 * Falls back to adding up the badges on the channels and DMs in the sidebar.
 */
const slackMentionScript = `( () => {
	const count = ( element ) => parseInt( element?.textContent ?? '', 10 ) || 0;
	const activity = document.querySelector( '[data-qa="tab_rail_activity_button"] .c-badge' );
	if ( activity ) {
		return count( activity );
	}
	return [ ...document.querySelectorAll( '.p-channel_sidebar__badge' ) ]
		.reduce( ( sum, badge ) => sum + count( badge ), 0 );
} )()`;

/**
 * Read Gmail's inbox unread count from the "Inbox" link in the side menu.
 * The page title only has the count while the inbox list is shown. It is replaced by
 * the subject while an email is open, so the title alone often misses new messages.
 * Falls back to the title when the side menu is not available.
 */
const gmailUnreadScript = `( () => {
	const inbox = document.querySelector( 'a[href$="#inbox"]' );
	if ( inbox ) {
		// Climb to the Inbox row, stopping before a parent that holds other menu items
		let row = inbox;
		while ( row.parentElement && row.parentElement.querySelectorAll( 'a[href*="#"]' ).length === 1 ) {
			row = row.parentElement;
		}
		const count = row.querySelector( '.bsU' );
		return count ? parseInt( count.textContent.replace( /[^0-9]/g, '' ), 10 ) || 0 : 0;
	}
	const match = document.title.match( /\\((\\d+)\\)/ );
	return match ? Number( match[ 1 ] ) : 0;
} )()`;

export const serviceTypes: ServiceType[] = [
	{
		type: 'gmail',
		label: 'Gmail',
		url: 'https://mail.google.com/mail/',
		color: '#ea4335',
		pollScript: gmailUnreadScript,
		parseBadge: ( result ) => Number( result ) || 0,
		// The count can change while an email is open, without the title changing
		defaultPollInterval: 5,
		// Gmail's favicon includes the unread count, so use the plain icon instead
		icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
	},
	{
		type: 'chatwork',
		label: 'Chatwork',
		url: 'https://www.chatwork.com/',
		color: '#e5332a',
		// e.g. "(3) Chatwork"
		parseBadge: countInParentheses,
	},
	{
		type: 'slack',
		label: 'Slack',
		url: 'https://app.slack.com/client',
		color: '#4a154b',
		// Only mentions and DMs count. Other unread messages are not shown, as in Slack's own app
		pollScript: slackMentionScript,
		parseBadge: ( result ) => Number( result ) || 0,
		// Slack's badges change without changing the page title
		defaultPollInterval: 5,
	},
	{
		type: 'google-calendar',
		label: 'Google Calendar',
		url: 'https://calendar.google.com/',
		color: '#4285f4',
	},
	{
		type: 'google-keep',
		label: 'Google Keep',
		url: 'https://keep.google.com/',
		color: '#fbbc04',
	},
];

export function findServiceType( type: string ): ServiceType | undefined {
	return serviceTypes.find( ( serviceType ) => serviceType.type === type );
}
