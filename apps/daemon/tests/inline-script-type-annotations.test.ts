import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The v0.5 removal pass rewrote `catch (e)` to `catch (e: any)` everywhere,
// including inside HTML/JS that the daemon serves as strings, where a type
// annotation is a browser SyntaxError that silently kills the whole script.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function typedCatchesInStrings(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node)
    ) {
      const match = /catch \(\w+: \w+\)/.exec(node.getText(sf));
      if (match) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf) + match.index);
        hits.push(`${path.relative(process.cwd(), file)}:${line + 1} ${match[0]}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe('served inline scripts', () => {
  it('carry no TypeScript catch-clause annotations', () => {
    const srcDir = path.resolve(import.meta.dirname, '../src');
    expect(sourceFiles(srcDir).flatMap(typedCatchesInStrings)).toEqual([]);
  });
});
