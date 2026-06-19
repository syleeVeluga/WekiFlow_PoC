import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readRecipe, regenerateFromRecipe, writeRecipe } from './recipe.js';

describe('recipe', () => {
  it('parses and writes recipe.yaml', async () => {
    const dir = join(tmpdir(), `wkf-recipe-${randomUUID()}`);
    await writeRecipe(dir, {
      sources: [{ type: 'reference', ref: 'manual://policy' }],
      seeds: ['https://example.com/policy'],
      params: { model: 'gpt-test', instruction: 'Summarize the policy.' },
    });

    await expect(readRecipe(dir)).resolves.toMatchObject({
      sources: [{ type: 'reference', ref: 'manual://policy' }],
      params: { model: 'gpt-test' },
    });
  });

  it('regenerates a stable draft and records recipe provenance', async () => {
    const dir = join(tmpdir(), `wkf-regenerate-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeRecipe(dir, {
      sources: [{ type: 'manual', ref: 'seed.md' }],
      seeds: [],
      params: { model: 'gpt-test', instruction: 'Create the canonical page.' },
    });

    const result = await regenerateFromRecipe(dir, { now: new Date('2026-06-19T00:00:00.000Z') });

    expect(result.written).toBe(true);
    await expect(readFile(result.outputPath, 'utf8')).resolves.toContain('recipe.yaml');
    expect(result.markdown).toContain('gpt-test');
  });
});
