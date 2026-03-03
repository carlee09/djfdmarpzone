# PRD: AI 바이럴 콘텐츠 마케팅 멀티-에이전트 시스템

**버전**: 0.3
**작성일**: 2026-03-03
**상태**: 운영 중

---

## 1. 개요

X(Twitter) 전용 바이럴 콘텐츠를 AI 에이전트가 자동 기획·생산하고, 사람이 승인 후 발행하는 자동화 시스템.

**콘텐츠 규칙**: 이모지 금지 / 해시태그 금지 / 280자 이내 / Human-in-the-loop 승인

---

## 2. 기술 스택

| 역할 | 기술 | 비고 |
|------|------|------|
| Agent 런타임 | Cloudflare Workers | 단일 Worker + 5개 Queue |
| 스케줄러 | Cloudflare Cron Triggers | 2시간마다 자동 실행 |
| 캐시/상태 | Cloudflare KV | 선호도 프로필 저장 |
| DB | Supabase PostgreSQL | jobs, agent_runs, trends, contents |
| LLM | Gemini 2.5 Flash | `responseMimeType: application/json` |
| 뉴스 수집 | ZDNet Korea RSS + Hacker News RSS | 직접 fetch, 무료 |
| 스크래핑 | Sela Network API | 현재 결과 미반환 (사실상 미사용) |
| 알림/승인 | Telegram Bot (Webhook) | 인라인 버튼으로 승인/반려 |

---

## 3. 파이프라인

```
Cron (2시간마다) 또는 POST /api/jobs
        ↓
Orchestrator: ZDNet+HN RSS → Gemini로 키워드 7개 자율 결정
        ↓
Trend Scout: 키워드 Google 검색 (Sela) → Gemini로 파생 키워드 3개 → 추가 검색
        ↓
Analyst: 트렌드 데이터 → Gemini로 콘텐츠 전략 수립
        ↓
Copywriter: 전략 + 선호도 프로필 → Gemini로 variant 3개 생성 (이모지/해시태그 후처리 제거)
        ↓
QA Reviewer: 규칙 검사 → Gemini 바이럴 점수 → 최고점 선정 (60점 이상)
        ↓
Telegram: 콘텐츠 + 키워드 + [✅ 승인] [❌ 반려] 버튼 전송
        ↓
승인/반려 → 선호도 학습 업데이트 (KV)
```

---

## 4. 선호도 학습

- 승인/반려 누적 → Gemini가 패턴 분석 → KV에 스타일 프로필 저장
- 5회 이상 누적 시 프로필 생성 시작
- 다음 Copywriter 실행 시 프로필 + 최근 승인 예시 3개 프롬프트 주입

---

## 5. API

**배포 URL**: `https://viral-content-agents.djfdmarp.workers.dev`

```
POST /api/jobs                 - 새 작업 생성 { goal }
GET  /api/jobs                 - 작업 목록
GET  /api/jobs/:id             - 작업 상태
GET  /api/jobs/:id/content     - 생성된 콘텐츠
POST /api/jobs/:id/approve     - 승인
POST /api/jobs/:id/reject      - 반려
POST /telegram/webhook         - 텔레그램 버튼 이벤트 수신
```

---

## 6. 알려진 이슈

| 이슈 | 상태 |
|------|------|
| Sela API 검색 결과 미반환 | 미해결 — Analyst가 Gemini 자체 지식으로 대체 동작 중 |
| QA 점수 기준 모호 | 개선 필요 — 3개 variant 모두 사용자에게 전송 방식 검토 중 |

---

## 7. 환경 변수 (Cloudflare Secrets)

```
SUPABASE_URL, SUPABASE_ANON_KEY
GEMINI_API_KEY
SELA_API_KEY, SELA_API_ENDPOINT, SELA_TIMEOUT_MS
TELEGRAM_TOKEN, TELEGRAM_CHAT_ID  (쉼표로 다중 ID 지원)
```
