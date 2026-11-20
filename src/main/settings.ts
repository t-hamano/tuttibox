import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serviceTypes } from './services';

/** サイドバーに追加したサービス 1 件分の設定 */
export interface ServiceConfig {
	/** インスタンス ID。セッションのパーティション名にも使う */
	id: string;
	/** serviceTypes の type */
	type: string;
	/** 表示名 (ツールチップ) */
	name: string;
	/** 未読バッジを表示するか */
	badge: boolean;
	/** ページに注入する CSS */
	css: string;
	/** ページ読み込み後に実行する JavaScript */
	js: string;
}

export interface Settings {
	bounds?: { x: number; y: number; width: number; height: number };
	maximized?: boolean;
	activeServiceId?: string;
	services: ServiceConfig[];
}

const file = () => join( app.getPath( 'userData' ), 'settings.json' );

/** 初回起動時は各サービスを 1 つずつ並べる。ID は旧バージョンのパーティション名と揃えてログイン状態を引き継ぐ */
function defaultServices(): ServiceConfig[] {
	return serviceTypes.map( ( serviceType ) => ( {
		id: serviceType.type,
		type: serviceType.type,
		name: serviceType.label,
		badge: true,
		css: '',
		js: '',
	} ) );
}

export function loadSettings(): Settings {
	let saved: Partial< Settings > = {};
	try {
		saved = JSON.parse( readFileSync( file(), 'utf8' ) ) as Partial< Settings >;
	} catch {
		// 初回起動
	}
	return {
		...saved,
		services: Array.isArray( saved.services ) ? saved.services : defaultServices(),
	};
}

export function saveSettings( settings: Settings ): void {
	try {
		writeFileSync( file(), JSON.stringify( settings, null, 2 ) );
	} catch ( error ) {
		console.error( 'Failed to save settings', error );
	}
}
