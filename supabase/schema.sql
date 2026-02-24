-- =============================================
-- 바이럴 콘텐츠 멀티-에이전트 시스템 스키마
-- =============================================

-- 작업 요청 테이블
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'awaiting_approval', 'approved', 'rejected')),
  goal text NOT NULL,
  keywords text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 에이전트 실행 로그 테이블
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  agent_name text NOT NULL
    CHECK (agent_name IN ('orchestrator', 'trend_scout', 'analyst', 'copywriter', 'qa_reviewer')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  input jsonb,
  output jsonb,
  error text,
  tokens_used int DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 트렌드 수집 데이터 테이블
CREATE TABLE trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('google', 'x')),
  keyword text,
  engagement_score float DEFAULT 0,
  raw_data jsonb NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now()
);

-- 생성된 콘텐츠 테이블
CREATE TABLE contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  variant_num int NOT NULL,
  body text NOT NULL,
  char_count int GENERATED ALWAYS AS (char_length(body)) STORED,
  viral_score float DEFAULT 0,
  qa_feedback text,
  is_selected bool DEFAULT false,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at 자동 갱신 함수
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 인덱스
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_agent_runs_job_id ON agent_runs(job_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_trends_job_id ON trends(job_id);
CREATE INDEX idx_contents_job_id ON contents(job_id);
CREATE INDEX idx_contents_is_selected ON contents(is_selected);
