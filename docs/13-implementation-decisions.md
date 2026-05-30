# 13. 구현 결정 기록

이 문서는 실제 PoC 스캐폴딩 중 확정한 구현 결정을 기록한다.

## Vector Search 모드

Phase 0 PoC 기본값은 `VECTOR_SEARCH_MODE=app-cosine`이다.

근거:

- 로컬 `mongo:8` 컨테이너는 일반 CRUD와 `$graphLookup` 검증에 충분하지만 Atlas Vector Search의 `$vectorSearch` 스테이지를 제공하지 않는다.
- PoC에서는 `chunks.embedding`을 저장하고 애플리케이션 레이어에서 코사인 유사도를 계산하는 구현으로 인터페이스를 검증한다.
- Atlas 클라우드 또는 Atlas CLI 로컬 배포로 전환할 때는 `tool_search_vector` 구현체만 교체한다.

운영 목표:

- 운영 또는 고도화 단계에서는 MongoDB Atlas Vector Search를 기본 구현으로 사용한다.
- 임베딩 차원은 `EMBEDDING_MODEL`과 Atlas Search Index의 `numDimensions`가 일치해야 한다.
