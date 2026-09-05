import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
// ─── Shared mutable state between mock factory and test body ───
const mockState = {
	workspaceFolders: undefined as
		| { uri: { fsPath: string; }; name: string; index: number; }[]
		| undefined,
	readdirMap: new Map<string, any>(),
	mkdirReturn: undefined as any,
	statReturn: { isDirectory() { return false; }, isFile() { return true; } },
	readFileContent: "",
	informationMessages: [] as string[],
	warningMessages: [] as string[],
	errorMessages: [] as string[],
};

// vitest hoists vi.mock above imports, so the mock is registered before
// handlers/index.ts is loaded.
vi.mock("./gu-fs-paths.js", async () => {
	return {
		readdir: vi.fn((p: string, opts?: any) =>
			Promise.resolve(
				opts?.withFileTypes
					? mockState.readdirMap.get(p) ?? []
					: [],
			),
		),
		stat: vi.fn(() => Promise.resolve(mockState.statReturn)),
		readFile: vi.fn(() => Promise.resolve(mockState.readFileContent)),
		writeFile: vi.fn(() => Promise.resolve(undefined)),
		access: vi.fn(() => Promise.resolve()),
		mkdir: vi.fn((_p: string, cb: any) => cb(mockState.mkdirReturn)),
	};
});

vi.mock("vscode", async () => {
	return {
		workspace: {
			getConfiguration: () => ({
				get: (_key: string, defaultValue: string[]) => defaultValue,
			}),
			get workspaceFolders() {
				return mockState.workspaceFolders;
			},
		},
		window: {
			showInformationMessage: (...args: any[]) => {
				mockState.informationMessages.push(
					typeof args[0] === "string" ? args[0] : String(args[0]),
				);
			},
			showWarningMessage: (...args: any[]) => {
				mockState.warningMessages.push(
					typeof args[0] === "string" ? args[0] : String(args[0]),
				);
			},
			showErrorMessage: (...args: any[]) => {
				mockState.errorMessages.push(
					typeof args[0] === "string" ? args[0] : String(args[0]),
				);
			},
		},
		Uri: {
			file: (fsPath: string) => ({ fsPath, path: fsPath }),
			parse: (s: string) => ({ fsPath: s.replace(/^[a-z]+:\/\//, ""), path: s }),
		},
	};
});

// Load handlers AFTER mock registrations above.
let handlers: typeof import("./index.js");

beforeAll(async () => {
	vi.resetModules();
	handlers = await import("./index.js");
});

beforeEach(() => {
	mockState.workspaceFolders = undefined;
	mockState.readdirMap.clear();
	mockState.mkdirReturn = undefined;
	mockState.statReturn = { isDirectory() { return false; }, isFile() { return true; } };
	mockState.readFileContent = "";
	mockState.informationMessages.length = 0;
	mockState.warningMessages.length = 0;
	mockState.errorMessages.length = 0;
	// Reset the internal override hook so tests start from a clean state.
	(handlers as any).__setHandleProjectAsync?.(handlers.handleProjectAsync);
});

function setWorkspaceFolders(
	folders: { uri: { fsPath: string; }; name: string; index: number; }[],
) {
	mockState.workspaceFolders = folders;
}

// ─── extractUsings ───

describe("extractUsings", () => {
	it("extracts simple using statements before namespace", () => {
		const content = "using System;\nusing System.Collections.Generic;\n\nnamespace MyApp {}";
		const { usings, updatedContent } = handlers.extractUsings(content);
		expect(usings).toEqual(["using System;", "using System.Collections.Generic;"]);
		expect(updatedContent).not.toContain("using System;");
		expect(updatedContent).toContain("namespace MyApp");
	});

	it("removes empty lines between usings and namespace", () => {
		const content = "using System;\n\nnamespace MyApp {}";
		const { usings, updatedContent } = handlers.extractUsings(content);
		expect(usings).toEqual(["using System;"]);
		expect(updatedContent).toBe("namespace MyApp {}");
	});

	it("extracts static and alias usings", () => {
		const content =
			"using System;\nusing static System.Math;\nusing Json = System.Text.Json.JsonSerializer;\n\nnamespace MyApp {}";
		const { usings } = handlers.extractUsings(content);
		expect(usings).toEqual([
			"using System;",
			"using static System.Math;",
			"using Json = System.Text.Json.JsonSerializer;",
		]);
	});

	it("does not remove usings after the namespace", () => {
		const content = "namespace MyApp {\n}using System.Text;\n";
		const { usings, updatedContent } = handlers.extractUsings(content);
		expect(usings).toEqual([]);
		expect(updatedContent).toContain("using System.Text;");
	});

	it("returns empty when no usings are present", () => {
		const content = "namespace MyApp {}";
		const { usings, updatedContent } = handlers.extractUsings(content);
		expect(usings).toEqual([]);
		expect(updatedContent).toBe("namespace MyApp {}");
	});

	it("handles a file with no namespace", () => {
		const content = "using System;\nusing System.Linq;\n";
		const { usings, updatedContent } = handlers.extractUsings(content);
		expect(usings).toEqual(["using System;", "using System.Linq;"]);
		expect(updatedContent).toBe("");
	});
});

// ─── formatGlobalUsings (exported for testability) ───

describe("formatGlobalUsings", () => {
	it("returns a newline-only string for an empty set (writeGlobalUsings guards the empty case)", () => {
		expect(handlers.formatGlobalUsings(new Set())).toBe("\n");
	});

	it("sorts usings with System group first", () => {
		const usings = new Set(["global using Microsoft.Extensions;", "global using System;"]);
		const result = handlers.formatGlobalUsings(usings);
		const lines = result.split("\n");
		const sysIdx = lines.findIndex((l) => l.startsWith("global using System"));
		const msIdx = lines.findIndex((l) =>
			l.startsWith("global using Microsoft.Extensions"),
		);
		expect(sysIdx).toBeGreaterThanOrEqual(0);
		expect(msIdx).toBeGreaterThanOrEqual(0);
		expect(sysIdx).toBeLessThan(msIdx);
	});

	it("groups System, Microsoft, and other usings with blank lines between groups", () => {
		const usings = new Set([
			"global using System.Linq;",
			"global using Microsoft.Extensions;",
			"global using MyApp.Helpers;",
		]);
		const result = handlers.formatGlobalUsings(usings);
		const nonEmpty = result.split("\n").filter((l) => l.trim().length > 0);
		expect(nonEmpty).toEqual([
			"global using System.Linq;",
			"global using Microsoft.Extensions;",
			"global using MyApp.Helpers;",
		]);
		expect(result).toContain("\n\n");
	});

	it("preserves the 'global using ' prefix (callers prepend it before passing in)", () => {
		expect(handlers.formatGlobalUsings(new Set(["global using System;"]))).toBe(
			"global using System;\n",
		);
	});
});

// ─── getNamespace (exported for testability) ───

describe("getNamespace", () => {
	it("returns namespace for simple using", () => {
		expect(handlers.getNamespace("global using System;")).toBe("System");
	});

	it("returns namespace for static using", () => {
		expect(handlers.getNamespace("global using static System.Math;")).toBe(
			"System.Math",
		);
	});

	it("returns alias target for alias using", () => {
		expect(handlers.getNamespace("global using Json = System.Text.Json;")).toBe(
			"System.Text.Json",
		);
	});
});



// ─── handleWorkspaceAsync ───
// gu-fs-paths is mocked via vi.mock("./gu-fs-paths.js") above.
// Uses the __setHandleProjectAsync internal hook to intercept per-project calls.

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "gu-test-"));
}

function cleanupTmpDir(dir: string) {
	try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("handleWorkspaceAsync", () => {
	it("shows warning when no workspace folder is open", async () => {
		setWorkspaceFolders([]);
		const results = await handlers.handleWorkspaceAsync();
		expect(results).toEqual([]);
		expect(mockState.warningMessages).toContain(
			"No workspace folder is currently open.",
		);
	});

	it("returns empty results when no .csproj files are found in workspace", async () => {
		const tmpDir = makeTmpDir();
		try {
			setWorkspaceFolders([{ uri: { fsPath: tmpDir }, name: "ws", index: 0 }]);
			const results = await handlers.handleWorkspaceAsync();
			expect(results).toEqual([]);
			expect(mockState.informationMessages).toEqual([]);
			expect(mockState.warningMessages).toEqual([]);
		} finally {
			cleanupTmpDir(tmpDir);
		}
	});

	it("processes each discovered .csproj by calling handleProjectAsync once per project", async () => {
		const tmpDir = makeTmpDir();
		try {
			fs.writeFileSync(path.join(tmpDir, "ProjectA.csproj"), "<Project />", "utf-8");
			setWorkspaceFolders([{ uri: { fsPath: tmpDir }, name: "ws", index: 0 }]);

			const fakeHandle = vi.fn(async (_p: string) => undefined);
			(handlers as any).__setHandleProjectAsync?.(fakeHandle);

			mockState.readdirMap.set(tmpDir, [
				{ name: "ProjectA.csproj", isDirectory() { return false; }, isFile() { return true; } },
			]);

			const results = await handlers.handleWorkspaceAsync();
			expect(fakeHandle).toHaveBeenCalledTimes(1);
			expect(fakeHandle).toHaveBeenCalledWith(
				path.join(tmpDir, "ProjectA.csproj"),
			);
			expect(results).toEqual([{ projectDir: tmpDir, success: true }]);
			expect(mockState.informationMessages).toContain(
				"Usings moved to GlobalUsings.cs for all 1 project(s) in workspace!",
			);
		} finally {
			cleanupTmpDir(tmpDir);
			(handlers as any).__setHandleProjectAsync?.(handlers.handleProjectAsync);
		}
	});

	it("isolates failures so one broken project does not prevent others from being processed", async () => {
		const tmpDir = makeTmpDir();
		try {
			fs.writeFileSync(path.join(tmpDir, "Good.csproj"), "<Project />", "utf-8");
			fs.writeFileSync(path.join(tmpDir, "Broken.csproj"), "<Project />", "utf-8");
			setWorkspaceFolders([{ uri: { fsPath: tmpDir }, name: "ws", index: 0 }]);

			const fakeHandle = vi.fn(async (p: string) => {
				if (p.includes("Broken")) {
					return Promise.reject(new Error("corrupt csproj"));
				}
				return undefined;
			});
			(handlers as any).__setHandleProjectAsync?.(fakeHandle);

			mockState.readdirMap.set(tmpDir, [
				{ name: "Good.csproj", isDirectory() { return false; }, isFile() { return true; } },
				{ name: "Broken.csproj", isDirectory() { return false; }, isFile() { return true; } },
			]);

			const results = await handlers.handleWorkspaceAsync();
			expect(fakeHandle).toHaveBeenCalledTimes(2);
			const succeeded = results.filter((r) => r.success);
			const failed = results.filter((r) => !r.success);
			expect(succeeded).toHaveLength(1);
			expect(failed).toHaveLength(1);
			expect(failed[0].projectDir).toBe(tmpDir);
			expect(failed[0].error).toBe("corrupt csproj");
			expect(mockState.warningMessages.length).toBeGreaterThan(0);
		} finally {
			cleanupTmpDir(tmpDir);
			(handlers as any).__setHandleProjectAsync?.(handlers.handleProjectAsync);
		}
	});

	it("processes multiple workspace folders", async () => {
		const tmpDir1 = makeTmpDir();
		const tmpDir2 = makeTmpDir();
		try {
			fs.writeFileSync(path.join(tmpDir1, "A.csproj"), "<Project />", "utf-8");
			fs.writeFileSync(path.join(tmpDir2, "B.csproj"), "<Project />", "utf-8");
			setWorkspaceFolders([
				{ uri: { fsPath: tmpDir1 }, name: "ws1", index: 0 },
				{ uri: { fsPath: tmpDir2 }, name: "ws2", index: 1 },
			]);

			const fakeHandle = vi.fn(async () => undefined);
			(handlers as any).__setHandleProjectAsync?.(fakeHandle);

			mockState.readdirMap.set(tmpDir1, [
				{ name: "A.csproj", isDirectory() { return false; }, isFile() { return true; } },
			]);
			mockState.readdirMap.set(tmpDir2, [
				{ name: "B.csproj", isDirectory() { return false; }, isFile() { return true; } },
			]);

			const results = await handlers.handleWorkspaceAsync();
			expect(fakeHandle).toHaveBeenCalledTimes(2);
			expect(results).toEqual([
				{ projectDir: tmpDir1, success: true },
				{ projectDir: tmpDir2, success: true },
			]);
			expect(mockState.informationMessages).toContain(
				"Usings moved to GlobalUsings.cs for all 2 project(s) in workspace!",
			);
		} finally {
			cleanupTmpDir(tmpDir1);
			cleanupTmpDir(tmpDir2);
			(handlers as any).__setHandleProjectAsync?.(handlers.handleProjectAsync);
		}
	});

	it("skips configured directories when discovering .csproj files", async () => {
		const tmpDir = makeTmpDir();
		try {
			for (const skip of ["bin", "obj", ".git"]) {
				fs.mkdirSync(path.join(tmpDir, skip));
			}
			fs.mkdirSync(path.join(tmpDir, "src"));
			fs.writeFileSync(path.join(tmpDir, "src", "App.csproj"), "<Project />", "utf-8");

			setWorkspaceFolders([{ uri: { fsPath: tmpDir }, name: "ws", index: 0 }]);

			const fakeHandle = vi.fn(async () => undefined);
			(handlers as any).__setHandleProjectAsync?.(fakeHandle);

			mockState.readdirMap.set(tmpDir, [
				{ name: "bin", isDirectory() { return true; }, isFile() { return false; } },
				{ name: "obj", isDirectory() { return true; }, isFile() { return false; } },
				{ name: ".git", isDirectory() { return true; }, isFile() { return false; } },
				{ name: "src", isDirectory() { return true; }, isFile() { return false; } },
			]);
			mockState.readdirMap.set(path.join(tmpDir, "src"), [
				{ name: "App.csproj", isDirectory() { return false; }, isFile() { return true; } },
			]);

			const results = await handlers.handleWorkspaceAsync();
			expect(fakeHandle).toHaveBeenCalledTimes(1);
			expect(fakeHandle).toHaveBeenCalledWith(
				path.join(tmpDir, "src", "App.csproj"),
			);
			expect(results).toEqual([{ projectDir: path.join(tmpDir, "src"), success: true }]);
		} finally {
			cleanupTmpDir(tmpDir);
			(handlers as any).__setHandleProjectAsync?.(handlers.handleProjectAsync);
		}
	});

	it("does not require .sln or .slnf to discover projects", async () => {
		const tmpDir = makeTmpDir();
		try {
			fs.writeFileSync(
				path.join(tmpDir, "LonelyProject.csproj"),
				"<Project />",
				"utf-8",
			);
			setWorkspaceFolders([{ uri: { fsPath: tmpDir }, name: "ws", index: 0 }]);

			const fakeHandle = vi.fn(async () => undefined);
			(handlers as any).__setHandleProjectAsync?.(fakeHandle);

			mockState.readdirMap.set(tmpDir, [
				{ name: "LonelyProject.csproj", isDirectory() { return false; }, isFile() { return true; } },
			]);

			await handlers.handleWorkspaceAsync();
			expect(fakeHandle).toHaveBeenCalledWith(
				path.join(tmpDir, "LonelyProject.csproj"),
			);
		} finally {
			cleanupTmpDir(tmpDir);
			(handlers as any).__setHandleProjectAsync?.(handlers.handleProjectAsync);
		}
	});
});
