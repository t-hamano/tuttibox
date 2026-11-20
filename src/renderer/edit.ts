interface EditData {
	name: string;
	badge: boolean;
	css: string;
	js: string;
	typeLabel: string;
	supportsBadge: boolean;
}

interface EditApi {
	get: () => Promise< EditData | null >;
	save: ( data: Pick< EditData, 'name' | 'badge' | 'css' | 'js' > ) => void;
	cancel: () => void;
}

( async () => {
	const api = ( window as unknown as { tuttiboxEdit: EditApi } ).tuttiboxEdit;
	const $ = < T extends HTMLElement >( id: string ) => document.getElementById( id ) as T;
	const form = $< HTMLFormElement >( 'form' );
	const name = $< HTMLInputElement >( 'name' );
	const badge = $< HTMLInputElement >( 'badge' );
	const css = $< HTMLTextAreaElement >( 'css' );
	const js = $< HTMLTextAreaElement >( 'js' );

	const data = await api.get();
	if ( ! data ) {
		api.cancel();
		return;
	}
	$( 'heading' ).textContent = `${ data.typeLabel } の編集`;
	name.value = data.name;
	badge.checked = data.badge;
	badge.disabled = ! data.supportsBadge;
	$( 'badge-note' ).hidden = data.supportsBadge;
	css.value = data.css;
	js.value = data.js;
	name.focus();

	// Tab キーでフォーカス移動せず、タブ文字を入力する
	for ( const textarea of [ css, js ] ) {
		textarea.addEventListener( 'keydown', ( event ) => {
			if ( event.key === 'Tab' && ! event.shiftKey ) {
				event.preventDefault();
				textarea.setRangeText( '\t', textarea.selectionStart, textarea.selectionEnd, 'end' );
			}
		} );
	}

	form.addEventListener( 'submit', ( event ) => {
		event.preventDefault();
		api.save( { name: name.value, badge: badge.checked, css: css.value, js: js.value } );
	} );
	$( 'cancel' ).addEventListener( 'click', () => api.cancel() );
	document.addEventListener( 'keydown', ( event ) => {
		if ( event.key === 'Escape' ) {
			api.cancel();
		}
	} );
} )();
