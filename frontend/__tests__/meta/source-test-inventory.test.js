import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../..");
const sourceRoot = path.join(repositoryRoot, "src");
const centralTestRoot = path.join(repositoryRoot, "__tests__");
const ignoredDirectories = new Set([".git", ".next", "build", "coverage", "node_modules", "out"]);

const walk = (directory, predicate) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : walk(entryPath, predicate);
    }

    return predicate(entryPath) ? [entryPath] : [];
  });

const findDirectories = (directory, name) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) {
      return [];
    }

    const entryPath = path.join(directory, entry.name);
    return [entry.name === name ? entryPath : null, ...findDirectories(entryPath, name)].filter(Boolean);
  });

const expectedTestPath = (sourcePath) => {
  const relativePath = path.relative(sourceRoot, sourcePath);
  return path.join(centralTestRoot, relativePath.replace(/\.(js|jsx)$/, ".test.$1"));
};

describe("central test inventory", () => {
  test("keeps exactly one __tests__ directory at the repository root", () => {
    expect(findDirectories(repositoryRoot, "__tests__")).toEqual([centralTestRoot]);
  });

  test("maps every JavaScript source module to a central unit test", () => {
    const sourceFiles = walk(sourceRoot, (filePath) => /\.(js|jsx)$/.test(filePath));
    const missingTests = sourceFiles.map(expectedTestPath).filter((testPath) => !fs.existsSync(testPath));

    expect(missingTests.map((testPath) => path.relative(repositoryRoot, testPath))).toEqual([]);
  });
});
