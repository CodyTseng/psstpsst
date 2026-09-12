import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ModuleKind, transpileModule } from 'typescript';

/** Inspect emitted imports without Jest mocks hiding module-initialization cycles. */
it('keeps the relay modules free of eager runtime dependency cycles', () => {
  const directory = resolve(__dirname, '..');
  const files = readdirSync(directory).filter((file) => file.endsWith('.ts'));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const { outputText } = transpileModule(readFileSync(resolve(directory, file), 'utf8'), {
      fileName: file,
      compilerOptions: { module: ModuleKind.CommonJS },
    });
    const dependencies = [...outputText.matchAll(/require\(["'](\.\/[^"']+)["']\)/g)]
      .map((match) => `${basename(match[1])}.ts`)
      .filter((dependency) => files.includes(dependency));
    graph.set(file, dependencies);
  }

  const visited = new Set<string>();
  const path: string[] = [];
  const cycles: string[] = [];
  const visit = (file: string) => {
    const index = path.indexOf(file);
    if (index !== -1) {
      cycles.push([...path.slice(index), file].join(' -> '));
      return;
    }
    if (visited.has(file)) return;
    path.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    path.pop();
    visited.add(file);
  };
  for (const file of files) visit(file);
  expect(cycles).toEqual([]);
});
