import * as vscode from "vscode";

export function getSkippedDirectories(): string[] {
	return vscode.workspace
		.getConfiguration("globalusings-helper")
		.get("skippedDirectories", [
			"bin",
			"obj",
			".vs",
			".git",
			"Properties",
		]) as string[];
}
