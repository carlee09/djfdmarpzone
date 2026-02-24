# PRD: AI 바이럴 콘텐츠 마케팅 멀티-에이전트 시스템

**버전**: 0.2
**작성일**: 2026-02-24
**상태**: Phase 1 완료 / Phase 2 완료 / Phase 3 진행 중

---

## 1. 개요 (Overview)

### 1.1 목적
X(Twitter) 트렌드 데이터를 기반으로, 여러 AI 에이전트가 협업하여 바이럴 콘텐츠를 자동으로 기획·생산하는 마케팅 자동화 시스템.

### 1.2 핵심 가치
- **속도**: 트렌드 감지 → 콘텐츠 발행까지 수분 내 완료
- **품질**: 에이전트 간 검토·피드백 루프로 품질 보증
- **확장성**: 새로운 에이전트/채널 추가 용이한 구조
- **비용**: 모두 무료 플랜 내에서 운영

---

## 2. 기술 스택 (Tech Stack)

| 역할 | 기술 | 무료 플랜 제한 | 비고 |
|------|------|---------------|------|
| Agent 런타임 | Cloudflare Workers | 100,000 req/day | 배포 완료 |
| Agent 메시지 큐 | Cloudflare Queues | 1M msg/month | 5개 큐 생성 완료 |
| 단기 캐시/상태 | Cloudflare KV | 100,000 read/day | 네임스페이스 생성 완료 |
| 영구 DB | Supabase PostgreSQL | 500MB | 스키마 생성 완료 |
| LLM | Gemini 2.0 Flash | 1,500 req/day, 15 RPM | 일일 한도 이슈 확인 중 |
| 트렌드/SNS 수집 | Sela Network API | 보유 중 | 동작 확인 완료 |

### 2.1 Sela Network API
- **엔드포인트**: `https://api.selanetwork.io/api/rpc/scrapeUrl`
- **지원 타입**: `HTML`, `TWITTER_PROFILE`, `TWITTER_POST`, `GOOGLE_SEARCH`
- **Google 뉴스 수집 방식**: `scrapeType: HTML` + `https://www.google.com/search?q={keyword}&tbm=nws`
- **X 스크래핑**: `scrapeType: TWITTER_PROFILE` or `TWITTER_POST`

---

## 3. 시스템 아키텍처

### 3.1 에이전트 구성 (Orchestrator + Worker)

```
사용자 / 스케줄러
(POST /api/jobs)
       │
       ▼
[orchestrator-queue]
       │
       ▼
Orchestrator Agent ──→ job status: running
       │
       ▼
[trend-scout-queue]
       │
       ▼
Trend Scout Agent ──→ Sela API (Google News + X)
       │               Supabase trends 테이블 저장
       ▼
[analyst-queue]
       │
       ▼
Analyst Agent ──→ Gemini LLM (트렌드 분석 + 전략 수립)
       │          Supabase agent_runs 저장
       ▼
[copywriter-queue]
       │
       ▼
Copywriter Agent ──→ Gemini LLM (X 포스트 3개 variant 생성)
       │              Supabase contents 저장
       ▼
[qa-queue]
       │
       ▼
QA Reviewer Agent ──→ 규칙 검사 (280자, 이모지, 해시태그)
       │               Gemini LLM (바이럴 점수 0-100)
       ▼
job status: awaiting_approval
       │
       ▼
담당자 검토 (GET /api/jobs/:id/content)
       │
   승인 / 반려
       │
POST /api/jobs/:id/approve or /reject
```

### 3.2 에이전트 상세 역할

#### Orchestrator Agent
- job 수신 → status `running` 변경
- Trend Scout Queue로 메시지 발송

#### Trend Scout Agent
- Google 뉴스 검색 (키워드당 1회)
- X 프로필 스크래핑 (지정된 계정)
- Google로 Twitter 콘텐츠 탐색 (`site:twitter.com {keyword}`)
- 결과 → `trends` 테이블 저장 → Analyst Queue 발송

#### Analyst Agent
- `trends` 데이터 취합
- Gemini로 바이럴 패턴/전략 분석
- 결과(JSON) → `agent_runs.output` 저장 → Copywriter Queue 발송

#### Copywriter Agent
- Analyst 전략을 바탕으로 X 포스트 3개 생성
- 규칙: 이모지 금지, 해시태그 금지, 280자 이내
- 결과 → `contents` 테이블 저장 → QA Queue 발송

#### QA Reviewer Agent
- 규칙 검사 (코드 레벨): 280자 초과, 이모지, 해시태그
- Gemini로 바이럴 점수 (0-100) 평가
- 60점 이상 중 최고점 선정 → job status `awaiting_approval`
- 전부 60점 미만 시 → job status `failed`

---

## 4. 데이터 모델 (Supabase)

```sql
-- 작업 요청
jobs (
  id uuid PK,
  status text  -- pending | running | done | failed | awaiting_approval | approved | rejected
  goal text,
  keywords text[],
  created_at timestamptz,
  updated_at timestamptz
)

-- 에이전트 실행 로그
agent_runs (
  id uuid PK,
  job_id uuid FK,
  agent_name text,   -- orchestrator | trend_scout | analyst | copywriter | qa_reviewer
  status text,       -- pending | running | done | failed
  input jsonb,
  output jsonb,
  error text,
  tokens_used int,
  started_at timestamptz,
  finished_at timestamptz
)

-- 트렌드 수집 데이터
trends (
  id uuid PK,
  job_id uuid FK,
  source text,           -- google | x
  keyword text,
  engagement_score float,
  raw_data jsonb,
  collected_at timestamptz
)

-- 생성된 콘텐츠
contents (
  id uuid PK,
  job_id uuid FK,
  variant_num int,
  body text,
  char_count int GENERATED, -- 자동 계산
  viral_score float,
  qa_feedback text,
  is_selected bool,
  approved_at timestamptz
)
```

---

## 5. API 엔드포인트

**배포 URL**: `https://viral-content-agents.djfdmarp.workers.dev`

```
POST /api/jobs                    - 새 작업 생성
  body: { goal, keywords[], twitterAccounts[] }

GET  /api/jobs                    - 작업 목록 전체
GET  /api/jobs/:id                - 작업 상태 조회
GET  /api/jobs/:id/content        - 생성된 콘텐츠 조회

POST /api/jobs/:id/approve        - 콘텐츠 승인 (발행 준비)
  body: { contentId }
POST /api/jobs/:id/reject         - 콘텐츠 반려
```

---

## 6. 콘텐츠 규칙 (Brand Guidelines)

- 플랫폼: X(Twitter) 전용
- 이모지 사용 **금지**
- 해시태그(#) 사용 **금지**
- **280자 이내** 완결 필수
- 발행: 사람이 승인 후 발행 (Human-in-the-loop)

---

## 7. 무료 플랜 제약 및 대응 전략

| 서비스 | 제약 | 대응 전략 |
|--------|------|----------|
| Gemini | 1,500 req/day, 15 RPM | 429 시 Queue 지연 재시도 (delaySeconds) |
| Sela Network | Rate limit 있음 | 429 시 Queue 지연 재시도 + 호출 간 2초 딜레이 |
| CF Workers | 100K req/day | 배치 처리, 불필요한 호출 최소화 |
| Supabase | 500MB | 오래된 trend 데이터 주기적 삭제 |

### 7.1 Rate Limit 처리 방식
- Gemini/Sela API 429 응답 시 `err.isRateLimit = true` 설정
- Queue Consumer에서 `message.retry({ delaySeconds: N })` 호출
- Worker 내부에서 대기하지 않음 (30초 실행 한도 초과 방지)

---

## 8. 개발 단계 (Milestones)

### Phase 1 - 기반 구축 ✅
- [x] Supabase 스키마 설계 및 생성
- [x] Cloudflare Workers 프로젝트 세팅
- [x] Gemini API 연동 유틸리티 (rate limit 재시도 포함)
- [x] Sela Network API 연동 유틸리티
- [x] Supabase REST API 클라이언트

### Phase 2 - 에이전트 개발 ✅
- [x] Orchestrator Agent
- [x] Trend Scout Agent (Google 뉴스 + X 스크래핑)
- [x] Analyst Agent
- [x] Copywriter Agent
- [x] QA Reviewer Agent (규칙 검사 + 바이럴 점수)

### Phase 3 - 통합 및 테스트 🔄
- [x] Cloudflare Queues 메시지 파이프라인
- [x] HTTP API 엔드포인트 (CRUD + 승인/반려)
- [x] Cloudflare 배포 완료
- [x] Orchestrator → Trend Scout 동작 확인
- [ ] Analyst → Copywriter → QA 전체 파이프라인 검증 (Gemini 쿼터 이슈 해결 후)
- [ ] 대시보드(기본 UI)

### Phase 4 - 이후 과제
- [ ] 콘텐츠 성과(engagement) 피드백 루프
- [ ] Cron 스케줄러 (매일 자동 실행)
- [ ] 관리 대시보드 UI

---

## 9. 결정 사항

- [x] **콘텐츠 발행 방식**: 사람이 승인 후 발행 (Human-in-the-loop)
- [x] **대상 플랫폼**: X(Twitter) 전용
- [x] **콘텐츠 규칙**: 이모지 금지, 해시태그 금지, 280자 이내
- [x] **스크래핑 API**: Sela Network (Google + X 통합)
- [x] **에이전트 구조**: 단일 Cloudflare Worker + 5개 Queue

---

## 10. 알려진 이슈

| 이슈 | 상태 | 해결 방안 |
|------|------|----------|
| Gemini 무료 플랜 일일 쿼터 `limit: 0` | 확인 중 | [ai.dev/rate-limit](https://ai.dev/rate-limit) 에서 쿼터 확인 필요. 계정 수준 제한일 수 있음 |
