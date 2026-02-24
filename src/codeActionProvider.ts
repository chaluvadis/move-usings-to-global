import * as vscode from 'vscode';

// Matches standard C# `using` directives (non-global), which are candidates to be moved to GlobalUsings.cs.
const USING_REGEX = /^using\s+(static\s+)?[^=;]+(?:\s*=\s*[^;]+)?;\s*$/;

export class MoveUsingsCodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorMove];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection
    ): vscode.CodeAction[] | undefined {
        if (!this.rangeContainsUsing(document, range)) {
            return undefined;
        }

        const action = new vscode.CodeAction(
            'Move usings to GlobalUsings.cs',
            vscode.CodeActionKind.RefactorMove
        );
        action.command = {
            command: 'extension.moveUsingsToGlobal',
            title: 'Move usings to GlobalUsings.cs',
            arguments: [document.uri]
        };

        return [action];
    }

    private rangeContainsUsing(document: vscode.TextDocument, range: vscode.Range): boolean {
        for (let i = range.start.line; i <= range.end.line; i++) {
            if (USING_REGEX.test(document.lineAt(i).text.trim())) {
                return true;
            }
        }
        return false;
    }
}
