import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

// Global output channel for logging
let outputChannel: vscode.OutputChannel;

// Backup system for rollback functionality
interface FileBackup {
	filePath: string;
	originalContent: string;
}

export function activate(context: vscode.ExtensionContext) {
	// Initialize output channel
	outputChannel = vscode.window.createOutputChannel('Move Usings to GlobalUsings.cs');
	context.subscriptions.push(outputChannel);
	
	log('Extension activated', 'INFO');

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.moveUsingsToGlobal', async (fileUri: vscode.Uri) => {
			try {
				log(`Command invoked for: ${fileUri.fsPath}`, 'INFO');
				
				if (fileUri.fsPath.endsWith('.sln')) {
					await handleSolution(fileUri.fsPath);
				} else if (fileUri.fsPath.endsWith('.csproj')) {
					await handleProject(fileUri.fsPath);
				} else if (fileUri.fsPath.endsWith('.cs')) {
					await handleCsFile(fileUri.fsPath);
				} else {
					const message = 'Please right-click a .sln, .csproj, or .cs file.';
					log(message, 'ERROR');
					vscode.window.showErrorMessage(message);
				}
			} catch (err: any) {
				const message = `Error: ${err.message}`;
				log(message, 'ERROR');
				vscode.window.showErrorMessage(message);
			}
		})
	);
}

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') {
	const timestamp = new Date().toISOString();
	const logMessage = `[${timestamp}] [${level}] ${message}`;
	outputChannel.appendLine(logMessage);
}

async function handleSolution(slnPath: string) {
	log(`Processing solution: ${slnPath}`, 'INFO');
	
	const slnDir = path.dirname(slnPath);
	const csprojPaths = await getCsprojPathsFromSln(slnPath, slnDir);

	if (csprojPaths.length === 0) {
		const message = 'No .csproj files found in solution.';
		log(message, 'WARN');
		vscode.window.showWarningMessage(message);
		return;
	}

	log(`Found ${csprojPaths.length} projects in solution`, 'INFO');

	for (const csprojPath of csprojPaths) {
		log(`Processing project: ${csprojPath}`, 'INFO');
		await handleProject(csprojPath);
	}

	const successMessage = 'Usings moved to GlobalUsings.cs for all projects in solution!';
	log(successMessage, 'INFO');
	vscode.window.showInformationMessage(successMessage);
}

async function getCsprojPathsFromSln(slnPath: string, slnDir: string): Promise<string[]> {
	try {
		const slnContent = await fs.promises.readFile(slnPath, 'utf8');
		const regex = /Project\(".*?"\)\s*=\s*".*?",\s*"(.+?\.csproj)",/g;
		const matches = Array.from(slnContent.matchAll(regex));
		const csprojPaths: string[] = [];
		
		for (const match of matches) {
			// Resolve relative path with respect to solution directory
			const relProjPath = match[1].replace(/\\/g, path.sep);
			const absProjPath = path.resolve(slnDir, relProjPath);
			
			try {
				await fs.promises.access(absProjPath, fs.constants.F_OK);
				csprojPaths.push(absProjPath);
				log(`Found project: ${absProjPath}`, 'INFO');
			} catch {
				log(`Project file not found: ${absProjPath}`, 'WARN');
			}
		}
		
		return csprojPaths;
	} catch (error: any) {
		log(`Error reading solution file: ${error.message}`, 'ERROR');
		throw error;
	}
}

async function handleProject(csprojPath: string) {
	log(`Processing project: ${csprojPath}`, 'INFO');
	
	const projectDir = path.dirname(csprojPath);
	const csFiles = await findCsFilesRecursively(projectDir);
	const allUsings = new Set<string>();
	const filesToModify: { filePath: string; usings: string[]; updatedContent: string; }[] = [];
	
	log(`Found ${csFiles.length} C# files to process`, 'INFO');

	// First pass: collect all usings and prepare changes
	for (const csFile of csFiles) {
		try {
			const content = await fs.promises.readFile(csFile, 'utf8');
			const { usings, updatedContent } = extractUsings(content);
			
			if (usings.length > 0) {
				usings.forEach(u => allUsings.add(u));
				filesToModify.push({ filePath: csFile, usings, updatedContent });
				log(`Found ${usings.length} using statements in ${csFile}`, 'INFO');
			}
		} catch (err: any) {
			log(`Could not read file ${csFile}: ${err.message}`, 'WARN');
		}
	}

	if (allUsings.size === 0) {
		const message = 'No using statements to move.';
		log(message, 'INFO');
		vscode.window.showInformationMessage(message);
		return;
	}

	// Check for conflicts and ambiguities
	const conflicts = await detectConflicts(Array.from(allUsings));
	if (conflicts.length > 0) {
		const conflictMessage = `Detected potential conflicts:\n${conflicts.join('\n')}`;
		log(`Conflicts detected: ${conflictMessage}`, 'WARN');
		
		const choice = await vscode.window.showWarningMessage(
			`Potential conflicts detected. Do you want to continue?`,
			{ modal: true },
			'Continue',
			'Cancel'
		);
		
		if (choice !== 'Continue') {
			log('Operation cancelled by user due to conflicts', 'INFO');
			return;
		}
	}

	// Show preview and get user confirmation
	const previewApproved = await showPreview(projectDir, filesToModify, allUsings);
	if (!previewApproved) {
		log('Operation cancelled by user after preview', 'INFO');
		return;
	}

	// Backup all files before modification
	const backups: FileBackup[] = [];
	for (const fileInfo of filesToModify) {
		try {
			const originalContent = await fs.promises.readFile(fileInfo.filePath, 'utf8');
			backups.push({ filePath: fileInfo.filePath, originalContent });
		} catch (err: any) {
			log(`Error creating backup for ${fileInfo.filePath}: ${err.message}`, 'ERROR');
			throw new Error(`Failed to create backup for ${fileInfo.filePath}`);
		}
	}
	
	// Backup GlobalUsings.cs if it exists
	const globalUsingsPath = path.join(projectDir, 'GlobalUsings.cs');
	try {
		await fs.promises.access(globalUsingsPath, fs.constants.F_OK);
		const originalGlobalContent = await fs.promises.readFile(globalUsingsPath, 'utf8');
		backups.push({ filePath: globalUsingsPath, originalContent: originalGlobalContent });
	} catch {
		// GlobalUsings.cs doesn't exist yet, which is fine
	}

	log(`Created backups for ${backups.length} files`, 'INFO');

	try {
		// Apply changes
		await applyChanges(filesToModify, projectDir, allUsings);
		
		// Update .csproj file to include GlobalUsings.cs
		await updateCsprojFile(csprojPath, globalUsingsPath);
		
		// Validate with dotnet build
		const buildSuccess = await validateBuild(projectDir);
		
		if (!buildSuccess) {
			log('Build failed, rolling back changes', 'ERROR');
			await rollbackChanges(backups);
			vscode.window.showErrorMessage('Build failed after moving usings. Changes have been rolled back.');
			return;
		}

		const successMessage = `Successfully moved ${allUsings.size} using statements to GlobalUsings.cs!`;
		log(successMessage, 'INFO');
		vscode.window.showInformationMessage(successMessage);
		
	} catch (error: any) {
		log(`Error during processing, rolling back: ${error.message}`, 'ERROR');
		await rollbackChanges(backups);
		throw error;
	}
}

async function handleCsFile(csFilePath: string) {
	log(`Processing single C# file: ${csFilePath}`, 'INFO');
	
	const projectDir = await getProjectDir(csFilePath);
	if (!projectDir) {
		const message = 'Could not find .csproj directory.';
		log(message, 'ERROR');
		vscode.window.showErrorMessage(message);
		return;
	}

	try {
		const content = await fs.promises.readFile(csFilePath, 'utf8');
		const { usings, updatedContent } = extractUsings(content);

		if (usings.length === 0) {
			const message = 'No using statements to move.';
			log(message, 'INFO');
			vscode.window.showInformationMessage(message);
			return;
		}

		log(`Found ${usings.length} using statements in file`, 'INFO');

		// Check for conflicts
		const conflicts = await detectConflicts(usings);
		if (conflicts.length > 0) {
			const conflictMessage = `Detected potential conflicts:\n${conflicts.join('\n')}`;
			log(`Conflicts detected: ${conflictMessage}`, 'WARN');
			
			const choice = await vscode.window.showWarningMessage(
				`Potential conflicts detected. Do you want to continue?`,
				{ modal: true },
				'Continue',
				'Cancel'
			);
			
			if (choice !== 'Continue') {
				log('Operation cancelled by user due to conflicts', 'INFO');
				return;
			}
		}

		// Show preview
		const allUsings = new Set(usings);
		const filesToModify = [{ filePath: csFilePath, usings, updatedContent }];
		const previewApproved = await showPreview(projectDir, filesToModify, allUsings);
		
		if (!previewApproved) {
			log('Operation cancelled by user after preview', 'INFO');
			return;
		}

		// Create backups
		const backups: FileBackup[] = [];
		backups.push({ filePath: csFilePath, originalContent: content });
		
		const globalUsingsPath = path.join(projectDir, 'GlobalUsings.cs');
		try {
			await fs.promises.access(globalUsingsPath, fs.constants.F_OK);
			const originalGlobalContent = await fs.promises.readFile(globalUsingsPath, 'utf8');
			backups.push({ filePath: globalUsingsPath, originalContent: originalGlobalContent });
		} catch {
			// GlobalUsings.cs doesn't exist yet
		}

		try {
			// Apply changes
			await applyChanges(filesToModify, projectDir, allUsings);
			
			// Update .csproj file
			const csprojPath = await findCsprojInDirectory(projectDir);
			if (csprojPath) {
				await updateCsprojFile(csprojPath, globalUsingsPath);
			}
			
			// Validate build
			const buildSuccess = await validateBuild(projectDir);
			
			if (!buildSuccess) {
				log('Build failed, rolling back changes', 'ERROR');
				await rollbackChanges(backups);
				vscode.window.showErrorMessage('Build failed after moving usings. Changes have been rolled back.');
				return;
			}

			const successMessage = `Successfully moved ${usings.length} using statements to GlobalUsings.cs!`;
			log(successMessage, 'INFO');
			vscode.window.showInformationMessage(successMessage);
			
		} catch (error: any) {
			log(`Error during processing, rolling back: ${error.message}`, 'ERROR');
			await rollbackChanges(backups);
			throw error;
		}
		
	} catch (error: any) {
		log(`Error reading file: ${error.message}`, 'ERROR');
		throw error;
	}
}

// Utility: Recursively find .cs files, skipping obj/bin folders
async function findCsFilesRecursively(dir: string): Promise<string[]> {
	let results: string[] = [];
	
	try {
		const list = await fs.promises.readdir(dir);
		
		for (const file of list) {
			const filePath = path.join(dir, file);
			
			try {
				const stat = await fs.promises.stat(filePath);
				
				if (stat.isDirectory()) {
					// Skip build output folders
					if (file === 'bin' || file === 'obj' || file === '.vs' || file.startsWith('.')) {
						continue;
					}
					const subResults = await findCsFilesRecursively(filePath);
					results = results.concat(subResults);
				} else if (filePath.endsWith('.cs') && !filePath.endsWith('GlobalUsings.cs')) {
					results.push(filePath);
				}
			} catch {
				// Skip files/directories we can't access
				continue;
			}
		}
	} catch (error: any) {
		log(`Error reading directory ${dir}: ${error.message}`, 'WARN');
	}
	
	return results;
}

async function getProjectDir(filePath: string): Promise<string | null> {
	let dir = path.dirname(filePath);
	
	while (dir !== path.parse(dir).root) {
		try {
			const files = await fs.promises.readdir(dir);
			if (files.some(f => f.endsWith('.csproj'))) {
				return dir;
			}
		} catch {
			// Continue searching up the directory tree
		}
		dir = path.dirname(dir);
	}
	
	return null;
}

async function findCsprojInDirectory(dir: string): Promise<string | null> {
	try {
		const files = await fs.promises.readdir(dir);
		const csprojFile = files.find(f => f.endsWith('.csproj'));
		return csprojFile ? path.join(dir, csprojFile) : null;
	} catch {
		return null;
	}
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

	// Remove empty lines left behind but preserve structure
	const updatedLines = lines.filter((line, index) => {
		if (line.trim() === '') {
			// Keep empty lines that are not in the using section
			return index >= namespaceIdx || lines.slice(0, index).some(l => l.trim() !== '' && !l.trim().startsWith('using '));
		}
		return true;
	});
	
	const updatedContent = updatedLines.join('\n');
	return { usings, updatedContent };
}

async function detectConflicts(usings: string[]): Promise<string[]> {
	const conflicts: string[] = [];
	const aliases = new Map<string, string[]>();
	const staticUsings = new Set<string>();
	
	for (const using of usings) {
		// Check for alias conflicts
		const aliasMatch = using.match(/^using\s+(\w+)\s*=\s*(.+);$/);
		if (aliasMatch) {
			const alias = aliasMatch[1];
			const target = aliasMatch[2];
			
			if (aliases.has(alias)) {
				const existing = aliases.get(alias)!;
				if (!existing.includes(target)) {
					existing.push(target);
					conflicts.push(`Alias conflict: '${alias}' maps to multiple types: ${existing.join(', ')}`);
				}
			} else {
				aliases.set(alias, [target]);
			}
		}
		
		// Check for static using conflicts
		const staticMatch = using.match(/^using\s+static\s+(.+);$/);
		if (staticMatch) {
			const staticType = staticMatch[1];
			if (staticUsings.has(staticType)) {
				conflicts.push(`Duplicate static using: ${staticType}`);
			}
			staticUsings.add(staticType);
		}
	}
	
	return conflicts;
}

async function showPreview(projectDir: string, filesToModify: { filePath: string; usings: string[]; updatedContent: string; }[], allUsings: Set<string>): Promise<boolean> {
	try {
		// Create a temporary GlobalUsings.cs content for preview
		const globalUsingsPath = path.join(projectDir, 'GlobalUsings.cs');
		const existingGlobalUsings = new Set<string>();
		
		try {
			const existingContent = await fs.promises.readFile(globalUsingsPath, 'utf8');
			existingContent.split('\n')
				.map(l => l.trim())
				.filter(l => l.startsWith('global using '))
				.forEach(l => existingGlobalUsings.add(l));
		} catch {
			// GlobalUsings.cs doesn't exist yet
		}
		
		// Add new global usings
		Array.from(allUsings).forEach(u => existingGlobalUsings.add(`global ${u}`));
		const newGlobalContent = Array.from(existingGlobalUsings).sort().join('\n') + '\n';
		
		// Create temporary files for diff preview
		const tempDir = path.join(require('os').tmpdir(), 'move-usings-preview');
		await fs.promises.mkdir(tempDir, { recursive: true });
		
		const tempOriginalGlobal = path.join(tempDir, 'GlobalUsings.original.cs');
		const tempNewGlobal = path.join(tempDir, 'GlobalUsings.new.cs');
		
		// Write original GlobalUsings.cs (or empty if it doesn't exist)
		let originalGlobalContent = '';
		try {
			originalGlobalContent = await fs.promises.readFile(globalUsingsPath, 'utf8');
		} catch {
			originalGlobalContent = '// File does not exist yet\n';
		}
		
		await fs.promises.writeFile(tempOriginalGlobal, originalGlobalContent, 'utf8');
		await fs.promises.writeFile(tempNewGlobal, newGlobalContent, 'utf8');
		
		// Show diff for GlobalUsings.cs
		const originalUri = vscode.Uri.file(tempOriginalGlobal);
		const newUri = vscode.Uri.file(tempNewGlobal);
		
		await vscode.commands.executeCommand('vscode.diff', 
			originalUri, 
			newUri, 
			'GlobalUsings.cs Changes Preview'
		);
		
		// Show summary of changes
		const summary = `
Changes Summary:
- ${filesToModify.length} file(s) will be modified
- ${allUsings.size} using statement(s) will be moved to GlobalUsings.cs

Files to be modified:
${filesToModify.map(f => `  • ${path.relative(projectDir, f.filePath)} (${f.usings.length} usings)`).join('\n')}

Using statements to move:
${Array.from(allUsings).map(u => `  • ${u}`).join('\n')}
		`.trim();
		
		log(`Preview summary:\n${summary}`, 'INFO');
		
		const choice = await vscode.window.showInformationMessage(
			`Preview the changes and confirm to proceed. ${filesToModify.length} file(s) will be modified.`,
			{ modal: true },
			'Apply Changes',
			'Cancel'
		);
		
		// Clean up temporary files
		try {
			await fs.promises.unlink(tempOriginalGlobal);
			await fs.promises.unlink(tempNewGlobal);
			await fs.promises.rmdir(tempDir);
		} catch {
			// Ignore cleanup errors
		}
		
		return choice === 'Apply Changes';
		
	} catch (error: any) {
		log(`Error showing preview: ${error.message}`, 'ERROR');
		vscode.window.showErrorMessage('Could not show preview. Do you want to continue anyway?');
		
		const choice = await vscode.window.showWarningMessage(
			'Could not show preview. Do you want to continue anyway?',
			{ modal: true },
			'Continue',
			'Cancel'
		);
		
		return choice === 'Continue';
	}
}

async function applyChanges(filesToModify: { filePath: string; usings: string[]; updatedContent: string; }[], projectDir: string, allUsings: Set<string>) {
	log('Applying changes to files', 'INFO');
	
	// Update all C# files
	for (const fileInfo of filesToModify) {
		await fs.promises.writeFile(fileInfo.filePath, fileInfo.updatedContent, 'utf8');
		log(`Updated file: ${fileInfo.filePath}`, 'INFO');
	}
	
	// Update GlobalUsings.cs
	await writeGlobalUsings(projectDir, allUsings);
}

async function writeGlobalUsings(projectDir: string, usingsSet: Set<string>) {
	if (usingsSet.size > 0) {
		const globalUsingsPath = path.join(projectDir, 'GlobalUsings.cs');
		
		// Merge with existing global usings if present
		let existing = new Set<string>();
		try {
			const lines = (await fs.promises.readFile(globalUsingsPath, 'utf8')).split('\n');
			lines.map(l => l.trim())
				.filter(l => l.startsWith('global using '))
				.forEach(l => existing.add(l));
		} catch {
			// File doesn't exist yet
		}
		
		Array.from(usingsSet).forEach(u => existing.add(`global ${u}`));
		const globalContent = Array.from(existing).sort().join('\n') + '\n';
		
		await fs.promises.writeFile(globalUsingsPath, globalContent, 'utf8');
		log(`Updated GlobalUsings.cs with ${existing.size} global using statements`, 'INFO');
	}
}

async function updateCsprojFile(csprojPath: string, globalUsingsPath: string) {
	try {
		log(`Updating project file: ${csprojPath}`, 'INFO');
		
		const csprojContent = await fs.promises.readFile(csprojPath, 'utf8');
		const globalUsingsFileName = path.basename(globalUsingsPath);
		
		// Check if GlobalUsings.cs is already referenced
		if (csprojContent.includes(globalUsingsFileName)) {
			log('GlobalUsings.cs is already included in the project file', 'INFO');
			return;
		}
		
		// Find the first ItemGroup or create one
		let updatedContent = csprojContent;
		
		if (csprojContent.includes('<ItemGroup>')) {
			// Add to existing ItemGroup
			const itemGroupMatch = csprojContent.match(/(\s*<ItemGroup>)/);
			if (itemGroupMatch) {
				const indent = itemGroupMatch[1].replace('<ItemGroup>', '');
				const insertPos = csprojContent.indexOf('<ItemGroup>') + '<ItemGroup>'.length;
				const newItem = `\n${indent}  <Compile Include="${globalUsingsFileName}" />`;
				updatedContent = csprojContent.slice(0, insertPos) + newItem + csprojContent.slice(insertPos);
			}
		} else {
			// Create new ItemGroup before closing </Project>
			const projectEndPos = csprojContent.lastIndexOf('</Project>');
			if (projectEndPos > -1) {
				const newItemGroup = `
  <ItemGroup>
    <Compile Include="${globalUsingsFileName}" />
  </ItemGroup>

`;
				updatedContent = csprojContent.slice(0, projectEndPos) + newItemGroup + csprojContent.slice(projectEndPos);
			}
		}
		
		if (updatedContent !== csprojContent) {
			await fs.promises.writeFile(csprojPath, updatedContent, 'utf8');
			log('Added GlobalUsings.cs to project file', 'INFO');
		}
		
	} catch (error: any) {
		log(`Error updating .csproj file: ${error.message}`, 'WARN');
		// Don't throw - this is not critical for the core functionality
	}
}

async function validateBuild(projectDir: string): Promise<boolean> {
	try {
		log('Validating build with dotnet build', 'INFO');
		
		const { stdout, stderr } = await execAsync('dotnet build', { 
			cwd: projectDir,
			timeout: 60000 // 60 seconds timeout
		});
		
		log(`Build output:\n${stdout}`, 'INFO');
		
		if (stderr) {
			log(`Build errors/warnings:\n${stderr}`, 'WARN');
		}
		
		// Check if build was successful
		const success = stdout.includes('Build succeeded') || !stdout.includes('Build FAILED');
		
		if (success) {
			log('Build validation passed', 'INFO');
		} else {
			log('Build validation failed', 'ERROR');
		}
		
		return success;
		
	} catch (error: any) {
		log(`Build validation failed: ${error.message}`, 'ERROR');
		return false;
	}
}

async function rollbackChanges(backups: FileBackup[]) {
	log(`Rolling back ${backups.length} files`, 'INFO');
	
	for (const backup of backups) {
		try {
			await fs.promises.writeFile(backup.filePath, backup.originalContent, 'utf8');
			log(`Restored: ${backup.filePath}`, 'INFO');
		} catch (error: any) {
			log(`Error restoring ${backup.filePath}: ${error.message}`, 'ERROR');
		}
	}
	
	log('Rollback completed', 'INFO');
}

export function deactivate() {
	if (outputChannel) {
		outputChannel.dispose();
	}
}
