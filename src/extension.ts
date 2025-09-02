import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('extension.moveUsingsToGlobal', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No file selected.');
            return;
        }

        const ext = path.extname(uri.fsPath).toLowerCase();
        if (ext !== '.cs' && ext !== '.csproj' && ext !== '.sln') {
            vscode.window.showErrorMessage('This action supports only .cs, .csproj, and .sln files.');
            return;
        }

        try {
            let usings: string[] = [];
            if (ext === '.cs') {
                const content = fs.readFileSync(uri.fsPath, 'utf8');
                usings = extractUsings(content);
            } else if (ext === '.csproj' || ext === '.sln') {
                // For .csproj/.sln, scan all .cs files in the project/solution folder
                const folder = path.dirname(uri.fsPath);
                const csFiles = findCsFiles(folder);
                for (const file of csFiles) {
                    const content = fs.readFileSync(file, 'utf8');
                    usings.push(...extractUsings(content));
                }
            }

            usings = Array.from(new Set(usings)); // deduplicate

            if (usings.length === 0) {
                vscode.window.showInformationMessage('No using statements found.');
                return;
            }

            const globalUsingsPath = path.join(path.dirname(uri.fsPath), 'GlobalUsings.cs');
            let globalUsingsContent = '';
            if (fs.existsSync(globalUsingsPath)) {
                globalUsingsContent = fs.readFileSync(globalUsingsPath, 'utf8');
            }

            const newUsings = usings.filter(u => !globalUsingsContent.includes(u));
            if (newUsings.length === 0) {
                vscode.window.showInformationMessage('All usings already present in GlobalUsings.cs.');
                return;
            }

            globalUsingsContent += '\n' + newUsings.map(u => `global ${u}`).join('\n');
            fs.writeFileSync(globalUsingsPath, globalUsingsContent);

            vscode.window.showInformationMessage(`Moved ${newUsings.length} using statements to GlobalUsings.cs.`);
        } catch (err: any) {
            vscode.window.showErrorMessage('Error moving usings: ' + err.message);
        }
    });

    context.subscriptions.push(disposable);
}

function extractUsings(content: string): string[] {
    const regex = /^using\s+[^;]+;/gm;
    return Array.from(content.matchAll(regex)).map(match => match[0]);
}

function findCsFiles(folder: string): string[] {
    let results: string[] = [];
    const files = fs.readdirSync(folder);
    for (const file of files) {
        const fullPath = path.join(folder, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results = results.concat(findCsFiles(fullPath));
        } else if (file.endsWith('.cs')) {
            results.push(fullPath);
        }
    }
    return results;
}

export function deactivate() {}