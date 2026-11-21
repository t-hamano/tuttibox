// Code editor for the Custom JavaScript field, bundled into dist/renderer/code-editor.js by esbuild
import { EditorState } from '@codemirror/state';
import {
	EditorView,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
	placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
	bracketMatching,
	defaultHighlightStyle,
	indentOnInput,
	indentUnit,
	syntaxHighlighting,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';

export interface CodeEditor {
	getValue: () => string;
}

const theme = EditorView.theme( {
	'&': { height: '100%', fontSize: '12px' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': { fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace' },
	'.cm-gutters': { borderRightColor: '#d9d9de', backgroundColor: '#f7f7f8', color: '#6b6d7a' },
} );

/** Replace the textarea with a JavaScript editor that starts with its value */
function create( textarea: HTMLTextAreaElement, label: string ): CodeEditor {
	// The editor lives in a shadow root so that its styles go into adopted style sheets,
	// which the page's Content Security Policy (style-src 'self') allows, instead of inline <style> tags
	const host = document.createElement( 'div' );
	host.className = 'code-editor';
	const root = host.attachShadow( { mode: 'open' } );
	textarea.after( host );
	textarea.hidden = true;

	const view = new EditorView( {
		root,
		parent: root,
		state: EditorState.create( {
			doc: textarea.value,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightActiveLine(),
				history(),
				drawSelection(),
				indentOnInput(),
				bracketMatching(),
				syntaxHighlighting( defaultHighlightStyle ),
				indentUnit.of( '\t' ),
				EditorState.tabSize.of( 4 ),
				javascript(),
				theme,
				placeholder( textarea.placeholder ),
				keymap.of( [ ...defaultKeymap, ...historyKeymap, indentWithTab ] ),
				EditorView.contentAttributes.of( { spellcheck: 'false', 'aria-label': label } ),
			],
		} ),
	} );

	return {
		getValue: () => view.state.doc.toString(),
	};
}

( window as unknown as { TuttiboxCodeEditor: { create: typeof create } } ).TuttiboxCodeEditor = { create };
