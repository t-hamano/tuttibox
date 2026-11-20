import { app, type WebContents } from 'electron';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceDefinition } from './services';

/**
 * サービスごとのユーザー CSS (<userData>/css/<id>.css) を管理する。
 * ファイルを保存すると開いているページに即時反映する。
 */
export class CssInjector {
	readonly dir = join( app.getPath( 'userData' ), 'css' );

	private targets = new Map<string, WebContents>();
	private keys = new Map<string, string>();

	constructor( services: ServiceDefinition[] ) {
		mkdirSync( this.dir, { recursive: true } );
		for ( const service of services ) {
			const path = this.pathFor( service.id );
			if ( ! existsSync( path ) ) {
				writeFileSync(
					path,
					`/* ${ service.name } に注入する CSS。保存すると即時反映されます。 */\n`
				);
			}
		}

		let timer: NodeJS.Timeout | undefined;
		watch( this.dir, ( _event, filename ) => {
			const id = filename?.toString().replace( /\.css$/, '' );
			if ( ! id || ! this.targets.has( id ) ) {
				return;
			}
			// エディタの保存で連続発火するのでまとめる
			clearTimeout( timer );
			timer = setTimeout( () => this.apply( id ), 100 );
		} );
	}

	/** ページ読み込みのたびに CSS を注入するよう登録する */
	register( id: string, webContents: WebContents ): void {
		this.targets.set( id, webContents );
		webContents.on( 'did-finish-load', () => {
			this.keys.delete( id );
			this.apply( id );
		} );
	}

	/** 全サービスの CSS を読み直して適用する */
	reloadAll(): void {
		for ( const id of this.targets.keys() ) {
			this.apply( id );
		}
	}

	private pathFor( id: string ): string {
		return join( this.dir, `${ id }.css` );
	}

	private async apply( id: string ): Promise< void > {
		const webContents = this.targets.get( id );
		if ( ! webContents || webContents.isDestroyed() ) {
			return;
		}
		let css = '';
		try {
			css = readFileSync( this.pathFor( id ), 'utf8' );
		} catch {
			// ファイルが無ければ何も注入しない
		}
		const oldKey = this.keys.get( id );
		if ( oldKey ) {
			await webContents.removeInsertedCSS( oldKey ).catch( () => {} );
			this.keys.delete( id );
		}
		if ( css.trim() ) {
			const key = await webContents.insertCSS( css, { cssOrigin: 'user' } );
			this.keys.set( id, key );
		}
	}
}
