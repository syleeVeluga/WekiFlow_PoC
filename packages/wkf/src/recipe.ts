import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

export const RecipeSourceSchema = z.object({
  type: z.enum(['manual', 'upload', 'api', 'url', 'reference']),
  ref: z.string().min(1),
});

export const RecipeSchema = z.object({
  sources: z.array(RecipeSourceSchema).min(1),
  seeds: z.array(z.string().url()).default([]),
  params: z.object({
    model: z.string().min(1),
    instruction: z.string().min(1),
  }),
});

export type WkfRecipe = z.infer<typeof RecipeSchema>;

export interface RegenerateOptions {
  dryRun?: boolean;
  now?: Date;
  draftAgent?: (input: { title: string; contentMarkdown: string; recipe: WkfRecipe }) => Promise<{
    markdown: string;
    changeSummary?: string;
  }>;
  runPipeline?: (input: { title: string; contentMarkdown: string; recipe: WkfRecipe }) => Promise<{
    markdown: string;
    changeSummary?: string;
  }>;
}

export interface RegenerateResult {
  recipePath: string;
  outputPath: string;
  markdown: string;
  written: boolean;
  changeSummary: string;
}

export async function readRecipe(dir: string): Promise<WkfRecipe> {
  const raw = await readFile(join(dir, 'recipe.yaml'), 'utf8');
  return RecipeSchema.parse(parseYaml(raw));
}

export async function writeRecipe(dir: string, recipe: WkfRecipe): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'recipe.yaml'), stringifyYaml(RecipeSchema.parse(recipe)), 'utf8');
}

function defaultMarkdown(dir: string, recipe: WkfRecipe, now: Date): string {
  const title = basename(dir) || 'regenerated';
  const sources = recipe.sources.map((source) => `- ${source.type}: ${source.ref}`).join('\n');
  const seeds = recipe.seeds.length > 0 ? `\n\n# Seeds\n${recipe.seeds.map((seed) => `- ${seed}`).join('\n')}` : '';
  return `---
type: REFERENCE
title: ${title}
status: DRAFT
---
# ${title}
${recipe.params.instruction}

# Sources
${sources}${seeds}

# Provenance
- recipe: recipe.yaml
- model: ${recipe.params.model}
- regenerated_at: ${now.toISOString()}
`;
}

export async function regenerateFromRecipe(dir: string, options: RegenerateOptions = {}): Promise<RegenerateResult> {
  const recipe = await readRecipe(dir);
  const now = options.now ?? new Date();
  const fallback = defaultMarkdown(dir, recipe, now);
  const runDraftAgent = options.draftAgent ?? options.runPipeline;
  const generated = runDraftAgent
    ? await runDraftAgent({ title: basename(dir) || 'regenerated', contentMarkdown: fallback, recipe })
    : { markdown: fallback, changeSummary: 'Generated deterministic recipe draft.' };
  const markdown = generated.markdown.includes('recipe.yaml')
    ? generated.markdown
    : `${generated.markdown.trimEnd()}\n\n# Provenance\n- recipe: recipe.yaml\n- model: ${recipe.params.model}\n`;
  const outputPath = join(dir, 'regenerated.md');
  if (!options.dryRun) {
    await writeFile(outputPath, markdown, 'utf8');
  }
  return {
    recipePath: join(dir, 'recipe.yaml'),
    outputPath,
    markdown,
    written: !options.dryRun,
    changeSummary: generated.changeSummary ?? 'Regenerated from recipe.yaml.',
  };
}
