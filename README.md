# Move Usings to GlobalUsings.cs VSCode Extension

A Visual Studio Code extension to refactor `using` statements in your C# projects. Move all top-level `using` statements to a `GlobalUsings.cs` file for simplified and modern C# project structure.

---

## Features

- **Right-click on `.cs` file:**  
  Move all `using` statements before the `namespace` declaration from the selected file into `GlobalUsings.cs` in the project root. Removes those `using` statements from the file.

- **Right-click on `.csproj` file:**  
  Recursively scans all `.cs` files in the project folder (excluding `bin`, `obj`, `.vs`), moves all top-level `using` statements to `GlobalUsings.cs` in the project root, and removes them from the individual files.

- **Right-click on `.sln` (solution) file:**  
  Parses the solution file for all referenced `.csproj` projects, applies the project-level logic to each project: all `using` statements are moved to their respective `GlobalUsings.cs` files.

- **Duplicate `global using` statements are prevented** in the generated `GlobalUsings.cs`.

- **Command available via right-click (context menu) in Explorer** for `.cs`, `.csproj`, and `.sln` files.

---

## How to Use

1. **Install the extension** in VSCode.
2. **Right-click** a `.cs`, `.csproj`, or `.sln` file in the Explorer sidebar.
3. Select **"Move Usings to GlobalUsings.cs"** from the context menu.
4. The extension will perform the refactor and show a notification when complete.

---

## Extension Icon

The extension uses a simple SVG icon representing the "using" keyword and global scope.

```svg
<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="128" height="128" rx="24" fill="#007ACC"/>
  <circle cx="64" cy="64" r="40" fill="#fff" stroke="#007ACC" stroke-width="4"/>
  <text x="64" y="72" text-anchor="middle" font-size="30" font-family="monospace" fill="#007ACC" font-weight="bold">using</text>
  <path d="M44 36 L84 92" stroke="#28a745" stroke-width="4" stroke-linecap="round"/>
</svg>
```

---

## Contributing

1. Fork the repo and clone locally.
2. Open in VSCode, run and debug the extension.
3. Submit a pull request for any improvements.

---

## License

MIT
