// Register editor features explicitly so optional contributions stay out of the bundle.
// Keep editing, accessibility, language-provider UI, and tokenization support.
// Diff editors, folding, sticky scroll, GPU commands, CodeLens, color pickers,
// inlay hints, token inspection, and section headers are unused
// by the Console and Data Explorer surfaces. The public API may retain core code.
// In Monaco 0.56, inlineCompletions also imports the SuggestController used by
// regular completion popups. Keep this public entry until suggest/register does so.
import "monaco-editor/features/anchorSelect/register";
import "monaco-editor/features/bracketMatching/register";
import "monaco-editor/features/caretOperations/register";
import "monaco-editor/features/clipboard/register";
import "monaco-editor/features/codeAction/register";
import "monaco-editor/features/codeEditor/register";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/comment/register";
import "monaco-editor/features/contextmenu/register";
import "monaco-editor/features/cursorUndo/register";
import "monaco-editor/features/dnd/register";
import "monaco-editor/features/documentSymbols/register";
import "monaco-editor/features/dropOrPasteInto/register";
import "monaco-editor/features/find/register";
import "monaco-editor/features/floatingMenu/register";
import "monaco-editor/features/fontZoom/register";
import "monaco-editor/features/format/register";
import "monaco-editor/features/gotoError/register";
import "monaco-editor/features/gotoLine/register";
import "monaco-editor/features/gotoSymbol/register";
import "monaco-editor/features/hover/register";
import "monaco-editor/features/indentation/register";
import "monaco-editor/features/inlineCompletions/register";
import "monaco-editor/features/inlineProgress/register";
import "monaco-editor/features/inPlaceReplace/register";
import "monaco-editor/features/insertFinalNewLine/register";
import "monaco-editor/features/iPadShowKeyboard/register";
import "monaco-editor/features/lineSelection/register";
import "monaco-editor/features/linesOperations/register";
import "monaco-editor/features/linkedEditing/register";
import "monaco-editor/features/links/register";
import "monaco-editor/features/longLinesHelper/register";
import "monaco-editor/features/middleScroll/register";
import "monaco-editor/features/multicursor/register";
import "monaco-editor/features/parameterHints/register";
import "monaco-editor/features/placeholderText/register";
import "monaco-editor/features/quickCommand/register";
import "monaco-editor/features/quickHelp/register";
import "monaco-editor/features/quickOutline/register";
import "monaco-editor/features/readOnlyMessage/register";
import "monaco-editor/features/referenceSearch/register";
import "monaco-editor/features/rename/register";
import "monaco-editor/features/semanticTokens/register";
import "monaco-editor/features/smartSelect/register";
import "monaco-editor/features/snippet/register";
import "monaco-editor/features/suggest/register";
import "monaco-editor/features/toggleHighContrast/register";
import "monaco-editor/features/toggleTabFocusMode/register";
import "monaco-editor/features/tokenization/register";
import "monaco-editor/features/unicodeHighlighter/register";
import "monaco-editor/features/unusualLineTerminators/register";
import "monaco-editor/features/wordHighlighter/register";
import "monaco-editor/features/wordOperations/register";
import "monaco-editor/features/wordPartOperations/register";
