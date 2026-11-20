export interface ServiceDefinition {
	/** 内部ID。セッションのパーティション名・CSS ファイル名にも使う */
	id: string;
	/** サイドバーのツールチップに表示する名前 */
	name: string;
	/** 起動時に開く URL */
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

export const services: ServiceDefinition[] = [
	{
		id: 'gmail',
		name: 'Gmail',
		url: 'https://mail.google.com/mail/',
		color: '#ea4335',
		// 例: "受信トレイ (3) - user@gmail.com - Gmail"
		parseBadge: countInParentheses,
	},
	{
		id: 'chatwork',
		name: 'Chatwork',
		url: 'https://www.chatwork.com/',
		color: '#e5332a',
		// 例: "(3) Chatwork"
		parseBadge: countInParentheses,
	},
	{
		id: 'google-calendar',
		name: 'Google カレンダー',
		url: 'https://calendar.google.com/',
		color: '#4285f4',
	},
	{
		id: 'google-keep',
		name: 'Google Keep',
		url: 'https://keep.google.com/',
		color: '#fbbc04',
	},
];
