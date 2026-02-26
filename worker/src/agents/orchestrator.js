// Orchestrator Agent
// 역할: goal을 분석해 검색 전략과 키워드를 자율 결정 후 에이전트 체인 시동

import { callGeminiJSON } from '../lib/gemini.js';
import { createClient } from '../lib/supabase.js';
import { fetchTrendingTopics } from '../lib/trends-rss.js';

export async function runOrchestrator(env, message) {
  const { jobId, twitterAccounts = [] } = message;
  const db = createClient(env);

  const [run] = await db.insert('agent_runs', {
    job_id: jobId,
    agent_name: 'orchestrator',
    status: 'running',
    input: { jobId },
    started_at: new Date().toISOString(),
  });

  try {
    const jobs = await db.select('jobs', { id: `eq.${jobId}` });
    const job = jobs[0];
    if (!job) throw new Error(`Job not found: ${jobId}`);

    await db.update('jobs', { status: 'running' }, { id: `eq.${jobId}` });

    // Google Trends RSS에서 오늘의 실시간 트렌딩 토픽 수집
    const trendingTopics = await fetchTrendingTopics(15);
    const trendingSection = trendingTopics.length > 0
      ? `\n오늘의 실시간 트렌딩 검색어 (Google Trends KR):\n${trendingTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : '';

    // Gemini로 목표 분석 → 검색 전략 자율 결정
    const prompt = `
당신은 바이럴 콘텐츠 마케팅 전략가입니다.
아래 목표를 달성하기 위한 트렌드 조사 전략을 수립하세요.

목표: ${job.goal}
오늘 날짜: ${new Date().toISOString().split('T')[0]}
${trendingSection}

트렌딩 검색어가 제공된 경우, 그 중 목표와 관련성 높은 것을 우선 키워드로 활용하세요.

다음 JSON 스키마로 응답하세요:
{
  "keywords": string[],        // 구글 뉴스 검색 키워드 5~7개 (한국어/영어 혼용 가능)
  "searchAngles": string[],    // 수집 방향 3가지 (예: "최신 논쟁", "실용 팁", "업계 반응")
  "targetAudience": string,    // 타겟 독자 한 줄 설명
  "contentTone": string        // 콘텐츠 톤 (예: "정보 제공형", "논쟁 유발형", "공감형")
}
`;

    const { data: strategy, tokensUsed } = await callGeminiJSON(env.GEMINI_API_KEY, prompt);

    // 결정된 키워드를 jobs 테이블에 저장
    await db.update('jobs', { keywords: strategy.keywords }, { id: `eq.${jobId}` });

    await db.update('agent_runs', {
      status: 'done',
      output: strategy,
      tokens_used: tokensUsed,
      finished_at: new Date().toISOString(),
    }, { id: `eq.${run.id}` });

    // Trend Scout로 전달 (전략 포함)
    await env.TREND_SCOUT_QUEUE.send({
      jobId,
      keywords: strategy.keywords,
      searchAngles: strategy.searchAngles,
      twitterAccounts,
    });

  } catch (err) {
    await db.update('agent_runs', {
      status: 'failed',
      error: err.message,
      finished_at: new Date().toISOString(),
    }, { id: `eq.${run.id}` });

    await db.update('jobs', { status: 'failed' }, { id: `eq.${jobId}` });
    throw err;
  }
}
