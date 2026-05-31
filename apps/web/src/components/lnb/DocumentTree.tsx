import { useTreeCategories } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { TreeCategory } from './TreeCategory.js';

// 미분류를 포함한 분류 목록은 서버(treeCategories → groupKnowledgeByCategory)가 항상 보장한다.
export function LnbDocumentTree() {
  const { data: categories = [] } = useTreeCategories();
  const treeSearch = useUiStore((s) => s.treeSearch);
  const setTreeSearch = useUiStore((s) => s.setTreeSearch);
  return (
    <>
      <input className="tree-search" value={treeSearch} placeholder="문서 검색" onChange={(e) => setTreeSearch(e.target.value)} />
      <div className="doc-tree">
        {categories.length === 0 ? (
          <div className="tree-empty">문서가 없습니다.</div>
        ) : (
          categories.map((category) => <TreeCategory key={category.id} category={category} />)
        )}
      </div>
    </>
  );
}
