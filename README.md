# Move Usings to GlobalUsings.cs

A Visual Studio Code extension to refactor `using` statements in your C# projects. Move all top-level `using` statements to a `GlobalUsings.cs` file for a simplified and modern C# project structure.

---

## Features

- **Right-click on `.cs` file:**  
  Move all `using` statements before the `namespace` declaration from the selected file into `GlobalUsings.cs` in the project root. Removes those `using` statements from the file.

- **Right-click on `.csproj` file:**  
  Recursively scans all `.cs` files in the project folder (excluding `bin`, `obj`, `.vs`), moves all top-level `using` statements to `GlobalUsings.cs` in the project root, and removes them from the individual files.

- **Right-click on `.sln` (solution) file:**  
  Parses the solution file for all referenced `.csproj` projects, applies the project-level logic to each project: all `using` statements are moved to their respective `GlobalUsings.cs` files.

- **Prevents duplicate `global using` statements** in the generated `GlobalUsings.cs`.

- **Available via context menu:**  
  Easily access the command by right-clicking `.cs`, `.csproj`, or `.sln` files in the Explorer sidebar.

---

## How to Use

1. **Install the extension** from the VS Code Marketplace.
2. In the Explorer sidebar, **right-click** a `.cs`, `.csproj`, or `.sln` file.
3. Select **"Move Usings to GlobalUsings.cs"** from the context menu.
4. The extension will refactor your code and display a notification when complete.

---

## Extension Icon

The extension features a simple SVG icon that visually represents the "using" keyword and global scope.

```svg
<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="128" height="128" rx="24" fill="#007ACC"/>
  <circle cx="64" cy="64" r="40" fill="#fff" stroke="#007ACC" stroke-width="4"/>
  <text x="64" y="72" text-anchor="middle" font-size="30" font-family="monospace" fill="#007ACC" font-weight="bold">using</text>
  <path d="M44 36 L84 92" stroke="#28a745" stroke-width="4" stroke-linecap="round"/>
</svg>
```

<img src="./icon.png" alt="Extension Icon" />

---

## Contributing

We welcome contributions!

1. Fork the repository and clone it locally.
2. Open the project in VS Code, and use the built-in debugger to run and test the extension.
3. Create a pull request detailing your changes and improvements.

---

## License

MIT License