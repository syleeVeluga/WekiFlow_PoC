import type { TreeCategory as TreeCategoryType } from '@wf/shared';
import { catTint } from '../../lib/format.js';
import { useUiStore } from '../../store.js';

export function TreeCategory({ category }: { category: TreeCategoryType }) {
  const { selectedDocId, treeOpen, treeSearch, openDoc, openCategory, toggleTree, openContextMenu } = useUiStore();
  const needle = treeSearch.trim().toLowerCase();
  const categoryMatches = category.name.toLowerCase().includes(needle);
  const items = needle
    ? category.items.filter((item) => categoryMatches || item.title.toLowerCase().includes(needle))
    : category.items;
  const forcedOpen = needle.length > 0 && items.length > 0;
  const open = forcedOpen || Boolean(treeOpen[category.name]);
  if (needle && items.length === 0) return null;

  return (
    <div className="tree-cat">
      <button
        type="button"
        className="tree-cat-row"
        onClick={() => {
          toggleTree(category.name);
          if (!open) openCategory(category.name);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          openContextMenu({ x: event.clientX, y: event.clientY, kind: 'category', id: category.id, name: category.name });
        }}
      >
        <span className={`tree-caret ${open ? 'open' : ''}`}>›</span>
        <span className="cat-dot" style={{ background: catTint(category.name) }} />
        <strong>{category.name}</strong>
        <span className="tree-count">{category.items.length}</span>
      </button>
      {open ? (
        <div className="tree-docs">
          {items.map((item) => (
            <button
              type="button"
              className={`tree-doc-row ${selectedDocId === item.id ? 'on' : ''}`}
              key={item.id}
              onClick={() => openDoc(item.id, item.category)}
              onContextMenu={(event) => {
                event.preventDefault();
                openContextMenu({ x: event.clientX, y: event.clientY, kind: 'page', id: item.id, name: item.title });
              }}
            >
              <span>▫</span>
              <span>{item.title}</span>
              {item.modCount > 0 ? <i className="tdot-upd" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
