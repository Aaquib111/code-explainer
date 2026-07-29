import * as vscode from "vscode";

const segmentDecoration = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	backgroundColor: "rgba(255, 190, 60, 0.035)",
});

const activeDecoration = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	backgroundColor: "rgba(255, 190, 60, 0.12)",
	borderWidth: "0 0 0 2px",
	borderStyle: "solid",
	borderColor: "rgba(255, 190, 60, 0.75)",
	overviewRulerColor: "rgba(255, 190, 60, 0.7)",
	overviewRulerLane: vscode.OverviewRulerLane.Center,
});

let currentSegment:
	| { filePath: string; startLine: number; endLine: number }
	| undefined;

function lineRange(
	document: vscode.TextDocument,
	startLine: number,
	endLine: number,
): vscode.Range {
	if (
		!Number.isInteger(startLine)
		|| !Number.isInteger(endLine)
		|| startLine < 1
		|| endLine < startLine
		|| endLine > document.lineCount
	) {
		throw new RangeError(
			`Lines ${startLine}-${endLine} are outside ${document.fileName} `
			+ `(1-${document.lineCount}).`,
		);
	}

	const start = new vscode.Position(startLine - 1, 0);
	const lastLine = document.lineAt(endLine - 1);
	const end = new vscode.Position(endLine - 1, lastLine.text.length);
	return new vscode.Range(start, end);
}

async function openEditor(
	filePath: string,
): Promise<{ document: vscode.TextDocument; editor: vscode.TextEditor }> {
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
	const editor = await vscode.window.showTextDocument(document, {
		preview: false,
		preserveFocus: false,
	});
	return { document, editor };
}

export async function highlightSegmentRange(
	filePath: string,
	startLine: number,
	endLine: number,
): Promise<void> {
	clearHighlights();
	const { document, editor } = await openEditor(filePath);
	const range = lineRange(document, startLine, endLine);

	currentSegment = { filePath, startLine, endLine };
	editor.setDecorations(segmentDecoration, [range]);
	editor.setDecorations(activeDecoration, []);
	editor.selection = new vscode.Selection(range.start, range.start);
	editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

export async function highlightSubRange(
	filePath: string,
	startLine: number,
	endLine: number,
): Promise<void> {
	const { document, editor } = await openEditor(filePath);
	const activeRange = lineRange(document, startLine, endLine);

	if (currentSegment?.filePath === filePath) {
		const segmentRange = lineRange(
			document,
			currentSegment.startLine,
			currentSegment.endLine,
		);
		editor.setDecorations(segmentDecoration, [segmentRange]);
	} else {
		editor.setDecorations(segmentDecoration, []);
	}
	editor.setDecorations(activeDecoration, [activeRange]);
	editor.selection = new vscode.Selection(activeRange.start, activeRange.start);
	editor.revealRange(activeRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function clearHighlights(): void {
	currentSegment = undefined;
	for (const editor of vscode.window.visibleTextEditors) {
		editor.setDecorations(segmentDecoration, []);
		editor.setDecorations(activeDecoration, []);
	}
}

export function disposeHighlights(): void {
	segmentDecoration.dispose();
	activeDecoration.dispose();
}
