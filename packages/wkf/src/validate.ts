import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { parse } from './parse.js';
import { parseCitations } from './sections.js';

export interface ValidationIssue {
  level: 'error' | 'warning';
  rule: string;
  path: string;
  message: string;
}

export interface ValidationPolicy {
  citations?: {
    required_for?: string[];
  };
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const RESERVED_MARKDOWN = new Set(['index.md', 'log.md']);

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const info = await stat(path);
    if (info.isDirectory()) files.push(...(await listFiles(path)));
    if (info.isFile()) files.push(path);
  }
  return files;
}

function reservedMarkdownIssue(path: string, content: string): ValidationIssue | undefined {
  const basename = path.split('/').pop();
  if (basename === 'index.md' && !/^#\s+/.test(content.trim())) {
    return { level: 'warning', rule: 'reserved-index-structure', path, message: 'index.md should start with a heading' };
  }
  if (basename === 'log.md' && content.trim() && !/^##\s+\d{4}-\d{2}-\d{2}/m.test(content)) {
    return { level: 'warning', rule: 'reserved-log-structure', path, message: 'log.md should use date-group headings' };
  }
  return undefined;
}

function parsePolicy(content: string, path: string, issues: ValidationIssue[]): ValidationPolicy {
  const parsed = parseDocument(content, { strict: true });
  if (parsed.errors.length > 0) {
    issues.push({ level: 'error', rule: 'policy-parseable', path, message: parsed.errors[0]!.message });
    return {};
  }
  const policy = parsed.toJSON();
  return policy && typeof policy === 'object' ? (policy as ValidationPolicy) : {};
}

export async function validate(bundlePath: string, policy?: ValidationPolicy): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const files = await listFiles(bundlePath);
  let activePolicy = policy ?? {};

  if (!policy) {
    const policyFile = files.find((file) => normalizePath(relative(bundlePath, file)).split('/').pop() === 'policy.yaml');
    if (policyFile) {
      activePolicy = parsePolicy(await readFile(policyFile, 'utf8'), normalizePath(relative(bundlePath, policyFile)), issues);
    }
  }

  for (const file of files) {
    const path = normalizePath(relative(bundlePath, file));
    const content = await readFile(file, 'utf8');
    const basename = path.split('/').pop() ?? path;

    if (basename === 'policy.yaml') {
      continue;
    }

    if (!basename.endsWith('.md')) continue;
    if (RESERVED_MARKDOWN.has(basename)) {
      const issue = reservedMarkdownIssue(path, content);
      if (issue) issues.push(issue);
      continue;
    }

    try {
      const doc = parse(content);
      if (!doc.frontmatter.type.trim()) {
        issues.push({ level: 'error', rule: 'frontmatter-type-required', path, message: 'type is required' });
      }
      const requiredFor = activePolicy.citations?.required_for ?? [];
      if (requiredFor.includes(doc.frontmatter.type) && parseCitations(doc.body).length === 0) {
        issues.push({ level: 'error', rule: 'citations-required', path, message: `${doc.frontmatter.type} requires # Citations` });
      }
    } catch (error) {
      issues.push({
        level: 'error',
        rule: 'frontmatter-parseable',
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: !issues.some((issue) => issue.level === 'error'), issues };
}
