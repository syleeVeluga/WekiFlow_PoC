import { describe, expect, it } from 'vitest';
import type { TreeNode } from '@wf/shared';
import { buildTree } from './buildTree.js';

function node(id: string, parentId: string | null, title = id): TreeNode {
  return { id, parentId, title, slug: id, isFolder: false, status: 'PUBLISHED' };
}

describe('buildTree', () => {
  it('nests children under their parents (infinite depth)', () => {
    const tree = buildTree([
      node('a', null),
      node('b', 'a'),
      node('c', 'b'),
      node('d', null),
    ]);

    expect(tree.map((n) => n.id)).toEqual(['a', 'd']);
    expect(tree[0]!.children.map((n) => n.id)).toEqual(['b']);
    expect(tree[0]!.children[0]!.children.map((n) => n.id)).toEqual(['c']);
    expect(tree[1]!.children).toEqual([]);
  });

  it('treats nodes with a missing parent as roots', () => {
    const tree = buildTree([node('orphan', 'ghost')]);
    expect(tree.map((n) => n.id)).toEqual(['orphan']);
  });

  it('returns an empty array for no nodes', () => {
    expect(buildTree([])).toEqual([]);
  });
});
