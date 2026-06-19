import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validate } from './validate.js';
import { appendLog } from './log.js';

describe('appendLog', () => {
  it('appends one deduplicated line under a date group', async () => {
    const root = join(tmpdir(), `wkf-log-${randomUUID()}`);
    await appendLog(root, {
      date: '2026-06-19T10:00:00.000Z',
      kind: 'Verify',
      slug: 'hr/policy.md',
      summary: '변경 없음, 재검증 완료',
      pipeline: 'C',
    });
    await appendLog(root, {
      date: '2026-06-19T10:00:00.000Z',
      kind: 'Verify',
      slug: 'hr/policy.md',
      summary: '변경 없음, 재검증 완료',
      pipeline: 'C',
    });

    await expect(readFile(join(root, 'log.md'), 'utf8')).resolves.toBe(
      '## 2026-06-19\n- **Verify** hr/policy.md: 변경 없음, 재검증 완료. [C]\n',
    );
  });

  it('keeps date groups newest first and passes validate reserved log checks', async () => {
    const root = join(tmpdir(), `wkf-log-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'wkf.yaml'), 'scope: test\n', 'utf8');
    await appendLog(root, { date: '2026-03-01T00:00:00.000Z', kind: 'Creation', slug: 'a.md', summary: '최초 등록', actor: 'sylee', pipeline: 'A' });
    await appendLog(root, { date: '2026-06-19T00:00:00.000Z', kind: 'Update', slug: 'a.md', summary: '보강', actor: 'sylee', pipeline: 'C' });

    const log = await readFile(join(root, 'log.md'), 'utf8');
    expect(log.indexOf('## 2026-06-19')).toBeLessThan(log.indexOf('## 2026-03-01'));
    await expect(validate(root)).resolves.toMatchObject({ ok: true });
  });
});
