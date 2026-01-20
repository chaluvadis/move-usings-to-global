import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DOMParser } from '@xmldom/xmldom';

function getSkippedDirectories(): string[] {
    return vscode.workspace.getConfiguration('globalusings-helper')
        .get('skippedDirectories', ['bin', 'obj', '.vs', '.git', 'Properties']) as string[];
}

export async function handleSolutionAsync(slnPath: string) {
    const slnDir = path.dirname(slnPath);
    const csprojPaths = await getCsprojPathsFromSln(slnPath, slnDir);

    if (csprojPaths.length === 0) {
        vscode.window.showWarningMessage('No .csproj files found in solution.');
        return;
    }

    await Promise.all(csprojPaths.map(handleProjectAsync));
    vscode.window.showInformationMessage('Usings moved to GlobalUsings.cs for all projects in solution!');
}

async function getCsprojPathsFromSln(slnPath: string, slnDir: string): Promise<string[]> {
    const slnContent = await fs.readFile(slnPath, 'utf8');
    const regex = /Project\(".*?"\)\s*=\s*".*?",\s*"(.+?\.csproj)",/g;
    const matches = Array.from(slnContent.matchAll(regex));
    const csprojPaths: string[] = [];
    for (const match of matches) {
        const relProjPath = match[1].replace(/\\/g, path.sep);
        const absProjPath = path.resolve(slnDir, relProjPath);
        if (await fileExists(absProjPath)) {
            csprojPaths.push(absProjPath);
        }
    }
    return csprojPaths;
}

export async function handleProjectAsync(csprojPath: string) {
    const projectDir = path.dirname(csprojPath);
    const csFiles = await findCsFilesRecursively(projectDir);
    const allUsings = new Set<string>();

    await Promise.all(csFiles.map(async csFile => {
        try {
            const content = await fs.readFile(csFile, 'utf8');
            const { usings, updatedContent } = extractUsings(content);
            usings.forEach(u => allUsings.add(u));
            if (usings.length > 0) {
                await fs.writeFile(csFile, updatedContent, 'utf8');
            }
        } catch {
            // Ignore unreadable files
        }
    }));

    await writeGlobalUsings(projectDir, allUsings);
}

export async function handleCsFileAsync(csFilePath: string) {
    const projectDir = await getProjectDir(csFilePath);
    if (!projectDir) {
        vscode.window.showErrorMessage('Could not find .csproj directory.');
        return;
    }
    const content = await fs.readFile(csFilePath, 'utf8');
    const { usings, updatedContent } = extractUsings(content);

    if (usings.length > 0) {
        await fs.writeFile(csFilePath, updatedContent, 'utf8');
        const globalUsingsPath = path.join(projectDir, 'GlobalUsings.cs');
        let existingGlobalUsings = new Set<string>();
        if (await fileExists(globalUsingsPath)) {
            const existingContent = await fs.readFile(globalUsingsPath, 'utf8');
            existingContent.split('\n')
                .map(l => l.trim())
                .filter(l => l.startsWith('global using '))
                .forEach(l => existingGlobalUsings.add(l));
        }
        usings.forEach(u => existingGlobalUsings.add(`global ${u}`));
        const globalContent = formatGlobalUsings(existingGlobalUsings);
        await fs.writeFile(globalUsingsPath, globalContent, 'utf8');
        vscode.window.showInformationMessage('Usings moved to GlobalUsings.cs!');
    } else {
        vscode.window.showInformationMessage('No usings to move.');
    }
}

export async function handleSlnxFileAsync(slnxPath: string) {
    const csprojPaths = await parseSlnxFileAsync(slnxPath);
    if (csprojPaths.length === 0) {
        vscode.window.showWarningMessage('No .csproj files found in .slnx solution.');
        return;
    }
    await Promise.all(csprojPaths.map(handleProjectAsync));
    vscode.window.showInformationMessage('Usings moved to GlobalUsings.cs for all projects in .slnx solution!');
}

// Recursively find .cs files, skipping directories as per settings
async function findCsFilesRecursively(dir: string): Promise<string[]> {
    const results: string[] = [];
    const skippedDirs = getSkippedDirectories();
    let list: string[];
    try {
        list = await fs.readdir(dir, { withFileTypes: true }) as unknown as string[];
    } catch {
        return results;
    }
    for (const fileOrDir of list as any[]) {
        const name = fileOrDir.name || fileOrDir; // Dirent or string
        const filePath = path.join(dir, name);
        if (fileOrDir.isDirectory ? fileOrDir.isDirectory() : (await fs.stat(filePath)).isDirectory()) {
            if (skippedDirs.includes(name) || name.startsWith('.')) { continue; }
            results.push(...await findCsFilesRecursively(filePath));
        } else if (name.endsWith('.cs') && name !== 'GlobalUsings.cs') {
            results.push(filePath);
        }
    }
    return results;
}

async function getProjectDir(filePath: string): Promise<string | null> {
    let dir = path.dirname(filePath);
    while (dir !== path.parse(dir).root) {
        try {
            const files = await fs.readdir(dir);
            if (files.some(f => f.endsWith('.csproj'))) {
                return dir;
            }
        } catch {
            // Ignore errors
        }
        dir = path.dirname(dir);
    }
    return null;
}

export function extractUsings(content: string): { usings: string[]; updatedContent: string } {
    const lines = content.split('\n');
    const usings: string[] = [];
    const linesToRemove = new Set<number>();
    let namespaceIdx = lines.findIndex(l => l.trim().startsWith('namespace '));
    if (namespaceIdx === -1) { namespaceIdx = lines.length; }

    for (let i = 0; i < namespaceIdx; ++i) {
        const trimmed = lines[i].trim();
        if (/^using\s+(static\s+)?[^=;]+(?:\s*=\s*[^;]+)?;\s*$/.test(trimmed)) {
            usings.push(trimmed);
            linesToRemove.add(i);
        } else if (trimmed === '') {
            // Mark empty lines in the using section (before namespace) for removal
            linesToRemove.add(i);
        }
    }

    const updatedContent = lines.filter((_, idx) => !linesToRemove.has(idx)).join('\n');
    return { usings, updatedContent };
}

function formatGlobalUsings(usingsSet: Set<string>): string {
    const sortedUsings = Array.from(usingsSet).sort((a, b) => {
        const nsA = getNamespace(a);
        const nsB = getNamespace(b);
        if (nsA.startsWith('System') && !nsB.startsWith('System')) { return -1; }
        if (!nsA.startsWith('System') && nsB.startsWith('System')) { return 1; }
        if (nsA.startsWith('Microsoft') && !nsB.startsWith('Microsoft')) { return -1; }
        if (!nsA.startsWith('Microsoft') && nsB.startsWith('Microsoft')) { return 1; }
        return nsA.localeCompare(nsB);
    });
    
    // Group usings and add empty lines between groups
    const systemUsings = sortedUsings.filter(u => getNamespace(u).startsWith('System'));
    const microsoftUsings = sortedUsings.filter(u => !getNamespace(u).startsWith('System') && getNamespace(u).startsWith('Microsoft'));
    const otherUsings = sortedUsings.filter(u => !getNamespace(u).startsWith('System') && !getNamespace(u).startsWith('Microsoft'));
    
    const groups = [systemUsings, microsoftUsings, otherUsings].filter(g => g.length > 0);
    return groups.map(g => g.join('\n')).join('\n\n') + '\n';
}

function getNamespace(usingLine: string): string {
    const trimmed = usingLine.replace(/^global using /, '');
    if (trimmed.startsWith('static ')) {
        return trimmed.substring(7).replace(';', '');
    }
    if (trimmed.includes(' = ')) {
        return trimmed.split(' = ')[1].replace(';', '');
    }
    return trimmed.replace(';', '');
}

async function writeGlobalUsings(projectDir: string, usingsSet: Set<string>) {
    if (usingsSet.size === 0) {
        vscode.window.showInformationMessage('No usings to move.');
        return;
    }
    const globalUsingsPath = path.join(projectDir, 'GlobalUsings.cs');
    let existing = new Set<string>();
    if (await fileExists(globalUsingsPath)) {
        const lines = (await fs.readFile(globalUsingsPath, 'utf8')).split('\n');
        lines.map(l => l.trim())
            .filter(l => l.startsWith('global using '))
            .forEach(l => existing.add(l));
    }
    usingsSet.forEach(u => existing.add(`global ${u}`));
    const globalContent = formatGlobalUsings(existing);
    await fs.writeFile(globalUsingsPath, globalContent, 'utf8');
    vscode.window.showInformationMessage('Usings moved to GlobalUsings.cs!');
}

async function parseSlnxFileAsync(slnxPath: string): Promise<string[]> {
    const slnxDir = path.dirname(slnxPath);
    const content = await fs.readFile(slnxPath, 'utf-8');
    // Use DOMParser if Node.js 20+ (recommended for .slnx XML)
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(content, "text/xml");
    const csprojPaths: string[] = [];
    const projects = xmlDoc.getElementsByTagName('Project');
    for (let j = 0; j < projects.length; j++) {
        const projPath = projects[j].getAttribute('Path');
        if (projPath && projPath.endsWith('.csproj')) {
            const absProjPath = path.resolve(slnxDir, projPath);
            if (await fileExists(absProjPath)) {
                csprojPaths.push(absProjPath);
            }
        }
    }
    return csprojPaths;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}