/** 追加できるサービスの種類 */
export interface ServiceType {
	type: string;
	/** 既定の表示名 */
	label: string;
	url: string;
	/** アイコン取得前に表示する頭文字の背景色 */
	color: string;
	/**
	 * ページタイトルから未読数を取り出す。
	 * 未読数を出さないサービスでは省略する。
	 */
	parseBadge?: ( title: string ) => number;
}

/** タイトル中の最初の "(数字)" を未読数として扱う */
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
		// 例: "受信トレイ (3) - user@gmail.com - Gmail"
		parseBadge: countInParentheses,
	},
	{
		type: 'chatwork',
		label: 'Chatwork',
		url: 'https://www.chatwork.com/',
		color: '#e5332a',
		// 例: "(3) Chatwork"
		parseBadge: countInParentheses,
	},
	{
		type: 'google-calendar',
		label: 'Google カレンダー',
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
