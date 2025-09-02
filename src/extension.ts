import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('extension.moveUsingsToGlobal', async (fileUri: vscode.Uri) => {
			try {
				if (fileUri.fsPath.endsWith('.sln')) {
					await handleSolution(fileUri.fsPath);
				} else if (fileUri.fsPath.endsWith('.csproj')) {
					await handleProject(fileUri.fsPath);
				} else if (fileUri.fsPath.endsWith('.cs')) {
					await handleCsFile(fileUri.fsPath);
				} else {
					vscode.window.showErrorMessage('Please right-click a .sln, .csproj, or .cs file.');
				}
			} catch (err: any) {
				vscode.window.showErrorMessage('Error: ' + err.message);
			}
		})
	);
}

async function handleSolution(slnPath: string) {
	const slnDir = path.dirname(slnPath);
	const csprojPaths = getCsprojPathsFromSln(slnPath, slnDir);

	if (csprojPaths.length === 0) {
		vscode.window.showWarningMessage('No .csproj files found in solution.');
		return;
	}

	for (const csprojPath of csprojPaths) {
		await handleProject(csprojPath);
	}

	vscode.window.showInformationMessage('Usings moved to GlobalUsings.cs for all projects in solution!');
}

function getCsprojPathsFromSln(slnPath: string, slnDir: string): string[] {
	const slnContent = fs.readFileSync(slnPath, 'utf8');
	const regex = /Project\(".*?"\)\s*=\s*".*?",\s*"(.+?\.csproj)",/g;
	const matches = Array.from(slnContent.matchAll(regex));
	const csprojPaths: string[] = [];
	for (const match of matches) {
		// Resolve relative path with respect to solution directory
		const relProjPath = match[1].replace(/\\/g, path.sep);
		const absProjPath = path.resolve(slnDir, relProjPath);
		if (fs.existsSync(absProjPath)) {
			csprojPaths.push(absProjPath);
		}
	}
	return csprojPaths;
}

async function handleProject(csprojPath: string) {
	const projectDir = path.dirname(csprojPath);
	const csFiles = findCsFilesRecursively(projectDir);
	const allUsings = new Set<string>();

	for (const csFile of csFiles) {
		try {
			let content = fs.readFileSync(csFile, 'utf8');
			const { usings, updatedContent } = extractUsings(content);
			usings.forEach(u => allUsings.add(u));
			if (usings.length > 0) {
				fs.writeFileSync(csFile, updatedContent, 'utf8');
			}
		} catch (err) {
			// Ignore unreadable files
		}
	}

	writeGlobalUsings(projectDir, allUsings);
}

async function handleCsFile(csFilePath: string) {
	const projectDir = getProjectDir(csFilePath);
	if (!projectDir) {
		vscode.window.showErrorMessage('Could not find .csproj directory.');
		return;
	}
	let content = fs.readFileSync(csFilePath, 'utf8');
	const { usings, updatedContent } = extractUsings(content);

	if (usings.length > 0) {
		fs.writeFileSync(csFilePath, updatedContent, 'utf8');
		const globalUsingsPath = path.join(projectDir, 'GlobalUsings.cs');
		let existingGlobalUsings = new Set<string>();
		if (fs.existsSync(globalUsingsPath)) {
			const existingContent = fs.readFileSync(globalUsingsPath, 'utf8');
			existingContent.split('\n')
				.map(l => l.trim())
				.filter(l => l.startsWith('global using '))
				.forEach(l => existingGlobalUsings.add(l));
		}
		usings.forEach(u => existingGlobalUsings.add(`global ${u}`));
		fs.writeFileSync(globalUsingsPath, Array.from(existingGlobalUsings).join('\n') + '\n', 'utf8');
		vscode.window.showInformationMessage('Usings moved to GlobalUsings.cs!');
	} else {
		vscode.window.showInformationMessage('No usings to move.');
	}
}

// Utility: Recursively find .cs files, skipping obj/bin folders
function findCsFilesRecursively(dir: string): string[] {
	let results: string[] = [];
	let list: string[];
	try {
		list = fs.readdirSync(dir);
	} catch {
		return results;
	}
	for (const file of list) {
		const filePath = path.join(dir, file);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(filePath);
		} catch {
			continue;
		}
		if (stat && stat.isDirectory()) {
			// Skip build output folders
			if (file === 'bin' || file === 'obj' || file === '.vs' || file.startsWith('.')) { continue; }
			results = results.concat(findCsFilesRecursively(filePath));
		} else if (filePath.endsWith('.cs') && !filePath.endsWith('GlobalUsings.cs')) {
			results.push(filePath);
		}
	}
	return results;
}

function getProjectDir(filePath: string): string | null {
	let dir = path.dirname(filePath);
	while (dir !== path.parse(dir).root) {
		if (fs.readdirSync(dir).some(f => f.endsWith('.csproj'))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	return null;
}

function extractUsings(content: string): { usings: string[]; updatedContent: string } {
	const lines = content.split('\n');
	const usings: string[] = [];
	let namespaceIdx = lines.findIndex(l => l.trim().startsWith('namespace '));
	if (namespaceIdx === -1) { namespaceIdx = lines.length; }

	for (let i = 0; i < namespaceIdx; ++i) {
		const trimmed = lines[i].trim();
		if (/^using\s+\S.*;$/.test(trimmed)) {
			usings.push(trimmed);
			lines[i] = ''; // Blank out the line
		}
	}

	// Remove empty lines left behind
	const updatedContent = lines.filter(l => l.trim() !== '').join('\n');
	return { usings, updatedContent };
}

function writeGlobalUsings(projectDir: string, usingsSet: Set<string>) {
	if (usingsSet.size > 0) {
		const globalUsingsPath = path.join(projectDir, 'GlobalUsings.cs');
		// Merge with existing global usings if present
		let existing = new Set<string>();
		if (fs.existsSync(globalUsingsPath)) {
			const lines = fs.readFileSync(globalUsingsPath, 'utf8').split('\n');
			lines.map(l => l.trim())
				.filter(l => l.startsWith('global using '))
				.forEach(l => existing.add(l));
		}
		Array.from(usingsSet).forEach(u => existing.add(`global ${u}`));
		const globalContent = Array.from(existing).join('\n') + '\n';
		fs.writeFileSync(globalUsingsPath, globalContent, 'utf8');
		vscode.window.showInformationMessage('Usings moved to GlobalUsings.cs!');
	} else {
		vscode.window.showInformationMessage('No usings to move.');
	}
}

export function deactivate() { }
