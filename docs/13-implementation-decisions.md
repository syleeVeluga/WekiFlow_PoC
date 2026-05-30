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

## Vercel AI SDK 6 API (Phase 2)

설치 버전: `ai@6.0.193`, `@ai-sdk/openai@3.0.67`.

설계 문서(`04`, `08`)의 표기와 실제 API의 차이를 다음과 같이 확정한다.

- `new Agent({...})`는 개념 표기다. `ai@6`에서 `Agent`는 인터페이스(타입)이고, 인스턴스화 가능한 클래스는 `ToolLoopAgent`(별칭 `Experimental_Agent`)다. 따라서 메인 루프는 `new ToolLoopAgent(...)`로 조립한다.
- 시스템 프롬프트는 `system`이 아니라 `instructions` 옵션으로 전달한다.
- 도구는 `tool({ description, inputSchema, execute })`로 정의하고, `inputSchema`/`outputSchema`는 zod로 작성한다(구 `parameters` 아님).
- 임베딩은 `embedMany({ model, values })`, 모델은 `openai.textEmbeddingModel(EMBEDDING_MODEL)`.
- `app-cosine` 벡터 검색은 `ai`가 export하는 `cosineSimilarity`로 구현한다.

테스트는 `ai/test`의 `MockLanguageModelV3` + `mockValues(...)`로 LLM을 결정론적으로 스크립트한다. `MockLanguageModelV3({ doGenerate: [...] })`에 **배열**을 직접 넘기면 인덱스 0이 소비되지 않는 오프바이원이 있으므로, 순차 응답은 반드시 `mockValues(...)`로 감싼다.
