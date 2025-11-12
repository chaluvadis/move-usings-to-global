# Move Usings to GlobalUsings.cs

A Visual Studio Code extension to refactor `using` statements in your **C#** projects. Move all top-level `using` statements to a `GlobalUsings.cs` file for a simplified and modern **C#** project structure.

---
[![Build & Release VS Code Extension](https://github.com/chaluvadis/move-usings-to-global/actions/workflows/main.yml/badge.svg?branch=main&event=deployment_status)](https://github.com/chaluvadis/move-usings-to-global/actions/workflows/main.yml)

## Features

- **Right-click on `.csproj` file:**  
  Recursively scans all `.cs` files in the project folder (excluding `bin`, `obj`, `.vs`), moves all top-level `using` statements to `GlobalUsings.cs` in the project root, and removes them from the individual files.

- **Right-click on `.sln` or `.slnx` (solution) file:**  
  Parses the solution file for all referenced `.csproj` projects, applies the project-level logic to each project: all `using` statements are moved to their respective `GlobalUsings.cs` files.

- **Prevents duplicate `global using` statements** in the generated `GlobalUsings.cs`.

- **Available via context menu:**  
  Easily access the command by right-clicking `.csproj`, `.sln` or `.slnx` files in the Explorer sidebar.

---

## How to Use

1. **Install the extension** from the VS Code Marketplace.
2. In the Explorer sidebar, **right-click** a `.csproj`, `.sln` or `.slnx` file.
3. Select **"Move Usings to GlobalUsings.cs"** from the context menu.
4. The extension will refactor your code and display a notification when complete.

---

## Contributing

We welcome contributions!

1. Fork the repository and clone it locally.
2. Open the project in VS Code, and use the built-in debugger to run and test the extension.
3. Create a pull request detailing your changes and improvements.

---

## License

MIT License
