import type { TreeNode } from '@wf/shared';

export interface TreeItem extends TreeNode {
  children: TreeItem[];
}

/**
 * Convert an adjacency list (parentId pointers) into a nested tree.
 * Nodes whose parentId is null or missing from the set become roots.
 * Order within each level follows the input order.
 */
export function buildTree(nodes: TreeNode[]): TreeItem[] {
  const items = new Map<string, TreeItem>();
  for (const node of nodes) {
    items.set(node.id, { ...node, children: [] });
  }

  const roots: TreeItem[] = [];
  for (const node of nodes) {
    const item = items.get(node.id)!;
    const parent = node.parentId ? items.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(item);
    } else {
      roots.push(item);
    }
  }
  return roots;
}
