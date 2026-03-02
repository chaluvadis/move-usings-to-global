import * as vscode from "vscode";
import * as path from "node:path";
import {
	handleCsFileAsync,
	handleProjectAsync,
	handleSlnxFileAsync,
	handleSolutionAsync,
	previewCsFileAsync,
	previewProjectAsync,
	previewSlnxFileAsync,
	previewSolutionAsync,
	type ProjectPreviewResult,
} from "./handlers";
import { MoveUsingsCodeActionProvider } from "./codeActionProvider";

const PREVIEW_SCHEME = "global-usings-preview";

class GlobalUsingsPreviewProvider
	implements vscode.TextDocumentContentProvider
{
	private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this._onDidChange.event;
	private _contents = new Map<string, string>();

	update(uri: vscode.Uri, content: string): void {
		this._contents.set(uri.toString(), content);
		this._onDidChange.fire(uri);
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this._contents.get(uri.toString()) ?? "";
	}
}

function formatPreviewContent(results: ProjectPreviewResult[]): string {
	const formatSection = (result: ProjectPreviewResult, prefix?: string): string => {
		const header = [
			prefix ? `// ${prefix}` : null,
			`// Preview: ${result.globalUsingsPath}`,
			`// Files with usings to move: ${result.csFilesWithUsings}`,
		]
			.filter(Boolean)
			.join("\n");
		if (!result.globalUsingsContent) {
			return `${header}\n// No usings to move.\n`;
		}
		return `${header}\n\n${result.globalUsingsContent}`;
	};

	if (results.length === 1) {
		return formatSection(results[0]);
	}

	return results
		.map((result) =>
			formatSection(result, `=== Project: ${result.projectDir} ===`),
		)
		.join("\n");
}

export function activate(context: vscode.ExtensionContext) {
	const previewProvider = new GlobalUsingsPreviewProvider();
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(
			PREVIEW_SCHEME,
			previewProvider,
		),
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			{ language: "csharp", scheme: "file" },
			new MoveUsingsCodeActionProvider(),
			{
				providedCodeActionKinds:
					MoveUsingsCodeActionProvider.providedCodeActionKinds,
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"extension.moveUsingsToGlobal",
			async (fileUri: vscode.Uri) => {
				try {
					const extension = path.extname(fileUri.fsPath);
					const fsPath = fileUri.fsPath;
					switch (extension) {
						case ".slnx":
							await handleSlnxFileAsync(fsPath);
							break;
						case ".sln":
							await handleSolutionAsync(fsPath);
							break;
						case ".csproj":
							await handleProjectAsync(fsPath);
							break;
						case ".cs":
							await handleCsFileAsync(fsPath);
							break;
						default:
							vscode.window.showErrorMessage(
								"Please right-click a .sln, .slnx, .csproj, or .cs file.",
							);
							break;
					}
				} catch (err: any) {
					vscode.window.showErrorMessage(`Error: ${err.message}`);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"extension.previewMoveUsingsToGlobal",
			async (fileUri: vscode.Uri) => {
				try {
					const extension = path.extname(fileUri.fsPath);
					const fsPath = fileUri.fsPath;
					let results: ProjectPreviewResult[];

					switch (extension) {
						case ".slnx": {
							results = await previewSlnxFileAsync(fsPath);
							if (results.length === 0) {
								vscode.window.showWarningMessage(
									"No .csproj files found in .slnx solution.",
								);
								return;
							}
							break;
						}
						case ".sln": {
							results = await previewSolutionAsync(fsPath);
							if (results.length === 0) {
								vscode.window.showWarningMessage(
									"No .csproj files found in solution.",
								);
								return;
							}
							break;
						}
						case ".csproj": {
							results = [await previewProjectAsync(fsPath)];
							break;
						}
						case ".cs": {
							const result = await previewCsFileAsync(fsPath);
							if (!result) {
								vscode.window.showErrorMessage(
									"Could not find .csproj directory.",
								);
								return;
							}
							results = [result];
							break;
						}
						default:
							vscode.window.showErrorMessage(
								"Please right-click a .sln, .slnx, .csproj, or .cs file.",
							);
							return;
					}

					const previewContent = formatPreviewContent(results);
					const previewUri = vscode.Uri.parse(
						`${PREVIEW_SCHEME}://preview/GlobalUsings-preview.cs`,
					);
					previewProvider.update(previewUri, previewContent);

					const doc =
						await vscode.workspace.openTextDocument(previewUri);
					await vscode.window.showTextDocument(doc, {
						preview: true,
						viewColumn: vscode.ViewColumn.Beside,
					});

					const choice = await vscode.window.showInformationMessage(
						"Preview: Move Usings to GlobalUsings.cs — review the changes above.",
						"Apply Changes",
						"Cancel",
					);

					if (choice === "Apply Changes") {
						await vscode.commands.executeCommand(
							"extension.moveUsingsToGlobal",
							fileUri,
						);
					}
				} catch (err: any) {
					vscode.window.showErrorMessage(`Error: ${err.message}`);
				}
			},
		),
	);
}

export function deactivate() {}
