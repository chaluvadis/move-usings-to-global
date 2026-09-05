import * as fs from "node:fs/promises";
export type { Dirent } from "node:fs";

export const readdir = fs.readdir.bind(fs);
export const stat = fs.stat.bind(fs);
export const readFile = fs.readFile.bind(fs);
export const writeFile = fs.writeFile.bind(fs);
export const access = fs.access.bind(fs);
export const mkdir = fs.mkdir.bind(fs);
