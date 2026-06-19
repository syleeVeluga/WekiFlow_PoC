# 05. 샌드박스 설계 & 보안 (Sandbox Design & Security — 격리 Docker)

> 사용자 확정: **E2B 대신 자체 호스팅 격리 Docker**. `dockerode`로 일회성(ephemeral) 컨테이너를 생성·실행·파기합니다.
> *Self-hosted, ephemeral Docker containers controlled via dockerode — the runtime for `tool_execute_sandbox_terminal`.*

---

## 1. 설계 목표 (Goals)

1. 에이전트가 `grep`/`awk`/`ripgrep`/`python`으로 **결정론적 팩트 탐색**을 수행(할루시네이션 차단).
2. 임의 코드 실행이므로 **강한 격리**(네트워크 차단, 파일시스템 read-only, 리소스 제한).
3. **일회성**: 잡(또는 호출)마다 새 컨테이너, 종료 즉시 파기. 상태 누수 없음.
4. **감사 가능**: 모든 명령/결과를 `sandbox_runs`에 기록.

---

## 2. 컨테이너 생애주기 (Lifecycle)

```
잡 시작 → 문서 스냅샷을 워크스페이스로 동기화(MinIO → 임시 dir)
        → dockerode.createContainer(하드닝 옵션)
        → start → exec(bash/python) → stdout/stderr/exitCode 캡처
        → stop & remove(force)  → 임시 dir 정리 → sandbox_runs 기록
```

- **마운트 모델**: 호스트 임시 디렉터리(잡별)에 MinIO의 대상 MD를 동기화하고 `/docs`로 **read-only** 바인드 마운트. (컨테이너에 MinIO 자격증명 노출 금지)
- **풀링(선택, 성능)**: PoC는 매 호출 생성/파기. 프로덕션은 warm pool 또는 `exec` 재사용 고려하되, 잡 간 파일시스템 격리 보장.

---

## 3. 하드닝 옵션 (dockerode `HostConfig`)

```ts
const container = await docker.createContainer({
  Image: 'wekiflow/sandbox:latest',
  Cmd: ['sleep', 'infinity'],            // exec로 명령 주입, 컨테이너는 대기
  User: '1000:1000',                     // non-root
  WorkingDir: '/work',
  Env: [],                               // 비밀/자격증명 주입 금지
  NetworkDisabled: true,                 // 네트워크 완전 차단
  HostConfig: {
    NetworkMode: 'none',
    ReadonlyRootfs: true,                // 루트 read-only
    AutoRemove: true,
    Binds: [
      `${jobTmpDir}/docs:/docs:ro`,      // 대상 문서 read-only
    ],
    Tmpfs: { '/work': 'rw,size=64m,mode=1777', '/tmp': 'rw,size=16m' }, // 쓰기 가능 영역 한정
    Memory: 256 * 1024 * 1024,           // 256MB
    MemorySwap: 256 * 1024 * 1024,       // swap 차단(=메모리와 동일)
    NanoCpus: 1_000_000_000,             // 1 CPU
    PidsLimit: 128,
    CapDrop: ['ALL'],                    // 모든 리눅스 capability 제거
    SecurityOpt: ['no-new-privileges:true'],
    Ulimits: [{ Name: 'nofile', Soft: 1024, Hard: 1024 }],
  },
});
```

**exec 실행:**

```ts
const exec = await container.exec({
  Cmd: ['bash', '-lc', userCommand],
  AttachStdout: true, AttachStderr: true,
  User: '1000:1000',
});
const stream = await exec.start({});
// dockerode.demuxStream으로 stdout/stderr 분리, 타임아웃·출력길이 제한 적용
```

---

## 4. 보안 체크리스트 (Security Checklist)

- [ ] **네트워크 차단** (`NetworkMode: none`) — 데이터 유출/외부 호출 방지.
- [ ] **read-only 루트** + 제한된 tmpfs만 쓰기 가능.
- [ ] **non-root + `CapDrop: ALL` + `no-new-privileges`**.
- [ ] **리소스 제한**: 메모리/CPU/PID/파일디스크립터/실행시간(timeout).
- [ ] **출력 제한**: stdout/stderr 길이 캡(예 64KB), 초과 시 `truncated`.
- [ ] **자격증명 미주입**: MinIO/DB 비밀을 컨테이너 env로 넣지 않음(호스트가 사전 동기화).
- [ ] **read-only 마운트**: 에이전트는 문서를 읽기만, 원본 변조 불가.
- [ ] **명령 검증/감사**: 위험 패턴 로깅, 모든 실행 `sandbox_runs` 기록.
- [ ] **이미지 최소화**: 불필요 바이너리 제거(공격 표면 축소).
- [ ] **호스트 Docker 소켓 보호**: 워커만 소켓 접근, 권한 최소화. (가능하면 rootless Docker)

> ⚠️ **호스트 Docker 소켓(`/var/run/docker.sock`) 노출은 사실상 루트 권한**과 동등. 워커를 별도 신뢰 경계에 두고, 가능하면 **rootless Docker** 또는 전용 격리 호스트에서 운영. 장기적으로 gVisor/Kata 같은 추가 격리 레이어 검토.

---

## 5. 샌드박스 베이스 이미지 (Dockerfile)

```dockerfile
# docker/sandbox/Dockerfile
FROM python:3.13-slim

# 결정론적 탐색 도구
RUN apt-get update && apt-get install -y --no-install-recommends \
    ripgrep grep gawk findutils coreutils jq \
 && rm -rf /var/lib/apt/lists/*

# non-root
RUN useradd -u 1000 -m sandbox
USER 1000:1000
WORKDIR /work
```

> `ripgrep`(`rg`)는 대용량 문서에서 grep보다 빠르고 안전. 에이전트 system prompt에서 우선 사용 권장.

---

## 6. `SandboxRunner` 인터페이스 (추상화 — 추후 E2B 교체 여지)

비록 Docker로 확정했지만, 인터페이스를 두면 후일 교체가 쉽다.

```ts
// packages/sandbox/src/types.ts
export interface SandboxRunner {
  run(input: {
    language: 'bash' | 'python';
    code: string;
    docsSnapshotDir: string;      // read-only로 마운트할 호스트 경로
    timeoutMs: number;
  }): Promise<{ stdout: string; stderr: string; exitCode: number; truncated: boolean }>;
}

// packages/sandbox/src/dockerRunner.ts  → DockerSandboxRunner implements SandboxRunner
```

`tool_execute_sandbox_terminal`은 `SandboxRunner`에만 의존한다. (의존성 역전)

---

## 7. 테스트 (Phase 2 핵심 PoC)

PRD가 "가장 먼저 검증하라"고 한 항목. 상세 스크립트는 [`11-testing-and-verification.md` §A](./11-testing-and-verification.md).

- ✅ 에이전트가 `tool_execute_sandbox_terminal`을 호출해 `rg -n "제4조 2항" /docs`를 실행하고, 정확한 라인을 stdout으로 반환받는다.
- ✅ 네트워크 차단/리소스 제한이 실제로 적용된다(예: `curl` 실패, 메모리 폭주 시 OOM-kill).
- ✅ 컨테이너가 호출 후 잔존하지 않는다(`docker ps -a` 클린).
