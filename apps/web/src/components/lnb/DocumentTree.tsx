import { useTreeCategories } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { TreeCategory } from './TreeCategory.js';

export function LnbDocumentTree() {
  const { data = [] } = useTreeCategories();
  const treeSearch = useUiStore((s) => s.treeSearch);
  const setTreeSearch = useUiStore((s) => s.setTreeSearch);
  return (
    <>
      <input className="tree-search" value={treeSearch} placeholder="문서 검색" onChange={(e) => setTreeSearch(e.target.value)} />
      <div className="doc-tree">
        {data.map((category) => <TreeCategory key={category.id} category={category} />)}
      </div>
    </>
  );
}
