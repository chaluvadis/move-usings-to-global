import * as vscode from 'vscode';
import * as path from 'path';
import { handleCsFileAsync, handleProjectAsync, handleSlnxFileAsync, handleSolutionAsync } from './handlers';
import { MoveUsingsCodeActionProvider } from './codeActionProvider';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			{ language: 'csharp', scheme: 'file' },
			new MoveUsingsCodeActionProvider(),
			{ providedCodeActionKinds: MoveUsingsCodeActionProvider.providedCodeActionKinds }
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.moveUsingsToGlobal', async (fileUri: vscode.Uri) => {
			try {
				const extension = path.extname(fileUri.fsPath);
				const fsPath = fileUri.fsPath;
				switch (extension) {
					case '.slnx':
						await handleSlnxFileAsync(fsPath);
						break;
					case '.sln':
						await handleSolutionAsync(fsPath);
						break;
					case '.csproj':
						await handleProjectAsync(fsPath);
						break;
					case '.cs':
						await handleCsFileAsync(fsPath);
						break;
					default:
						vscode.window.showErrorMessage('Please right-click a .sln, .slnx, .csproj, or .cs file.');
						break;
				}
			} catch (err: any) {
				vscode.window.showErrorMessage('Error: ' + err.message);
			}
		})
	);
}

export function deactivate() { }