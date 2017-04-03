import * as vscode from 'vscode';



export default class ASMOutputContentProvider implements vscode.TextDocumentContentProvider {
	private content = "";
    public provideTextDocumentContent(uri: vscode.Uri): string {
			return this.getASMOutput();
	}
	public setContent(content: string) {
		this.content = content;
	}
	private getASMOutput() {
		return "<html><code>" + this.content + "</code></html>";
	}

}