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
}

/** Treat the first "(number)" in the title as the unread count */
function countInParentheses( title: string ): number {
	const match = title.match( /\((\d+)\)/ );
	return match ? Number( match[ 1 ] ) : 0;
}

export const serviceTypes: ServiceType[] = [
	{
		type: 'gmail',
		label: 'Gmail',
		url: 'https://mail.google.com/mail/',
		color: '#ea4335',
		// e.g. "Inbox (3) - user@gmail.com - Gmail"
		parseBadge: countInParentheses,
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
