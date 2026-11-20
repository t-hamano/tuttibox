interface SidebarItem {
	id: string;
	name: string;
	color: string;
	icon?: string;
	badge: number;
	active: boolean;
}

interface TuttiboxApi {
	onState: ( callback: ( items: SidebarItem[] ) => void ) => void;
	select: ( id: string ) => void;
	setOverlay: ( dataUrl: string | null, total: number ) => void;
}

( () => {
	const api = ( window as unknown as { tuttibox: TuttiboxApi } ).tuttibox;
	const container = document.getElementById( 'services' )!;
	let lastTotal = -1;

	if ( navigator.userAgent.includes( 'Mac' ) ) {
		document.body.classList.add( 'is-mac' );
	}

	function formatBadge( count: number ): string {
		return count > 99 ? '99+' : String( count );
	}

	function render( items: SidebarItem[] ): void {
		container.replaceChildren(
			...items.map( ( item ) => {
				const button = document.createElement( 'button' );
				button.className = 'service' + ( item.active ? ' is-active' : '' );
				button.title = item.name;
				button.setAttribute( 'aria-label', item.name );
				button.setAttribute( 'aria-current', item.active ? 'page' : 'false' );
				button.addEventListener( 'click', () => api.select( item.id ) );

				const letter = document.createElement( 'span' );
				letter.className = 'letter';
				letter.style.background = item.color;
				letter.textContent = item.name.charAt( 0 );

				if ( item.icon ) {
					const img = document.createElement( 'img' );
					img.className = 'icon';
					img.alt = '';
					img.src = item.icon;
					// favicon が読めなければ頭文字に戻す
					img.addEventListener( 'error', () => img.replaceWith( letter ) );
					button.append( img );
				} else {
					button.append( letter );
				}

				if ( item.badge > 0 ) {
					const badge = document.createElement( 'span' );
					badge.className = 'badge';
					badge.textContent = formatBadge( item.badge );
					button.append( badge );
				}
				return button;
			} )
		);

		const total = items.reduce( ( sum, item ) => sum + item.badge, 0 );
		if ( total !== lastTotal ) {
			lastTotal = total;
			api.setOverlay( total > 0 ? drawOverlay( total ) : null, total );
		}
	}

	/** Windows タスクバー用のオーバーレイアイコン (赤丸に数字) を描く */
	function drawOverlay( total: number ): string {
		const size = 32;
		const canvas = document.createElement( 'canvas' );
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext( '2d' )!;
		ctx.fillStyle = '#e5332a';
		ctx.beginPath();
		ctx.arc( size / 2, size / 2, size / 2, 0, Math.PI * 2 );
		ctx.fill();
		const text = formatBadge( total );
		ctx.fillStyle = '#ffffff';
		ctx.font = `bold ${ text.length > 2 ? 13 : 18 }px "Segoe UI", sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText( text, size / 2, size / 2 + 1 );
		return canvas.toDataURL( 'image/png' );
	}

	api.onState( render );
} )();
