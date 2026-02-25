// Analyst Agent
// 역할: 수집된 트렌드를 분석해서 콘텐츠 전략 수립

import { callGeminiJSON } from '../lib/gemini.js';
import { createClient } from '../lib/supabase.js';

export async function runAnalyst(env, message) {
  const { jobId } = message;
  const db = createClient(env);

  const [run] = await db.insert('agent_runs', {
    job_id: jobId,
    agent_name: 'analyst',
    status: 'running',
    input: { jobId },
    started_at: new Date().toISOString(),
  });

  try {
    // 트렌드 데이터 조회
    const trends = await db.select('trends', { job_id: `eq.${jobId}` });
    const job = await db.select('jobs', { id: `eq.${jobId}` });

    const trendSummary = buildTrendSummary(trends);

    const prompt = `
당신은 바이럴 콘텐츠 전략 전문가입니다.
아래 수집된 트렌드 데이터를 분석하고, X(Twitter) 바이럴 포스트를 위한 콘텐츠 전략을 수립하세요.

목표: ${job[0]?.goal}
키워드: ${job[0]?.keywords?.join(', ')}

수집된 트렌드 데이터:
${trendSummary}

다음 JSON 스키마로 응답하세요:
{
  "topTopics": string[],
  "viralTriggers": string[],
  "targetEmotion": string,
  "contentAngle": string,
  "hookStyle": string,
  "avoidTopics": string[],
  "contentBrief": string
}
`;

    const { data: analysis, tokensUsed } = await callGeminiJSON(env.GEMINI_API_KEY, prompt);

    await db.update('agent_runs', {
      status: 'done',
      output: analysis,
      tokens_used: tokensUsed,
      finished_at: new Date().toISOString(),
    }, { id: `eq.${run.id}` });

    // Copywriter Queue로 전달
    await env.COPYWRITER_QUEUE.send({ jobId, analysis });

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

function buildTrendSummary(trends) {
  return trends.map(t => {
    const data = t.raw_data;
    if (t.source === 'google') {
      const items = data.items || [];
      return `[Google - ${t.keyword}]\n` +
        items.map(i => `- ${i.title}: ${i.snippet}`).join('\n');
    } else {
      const posts = data.posts || data.items || [];
      return `[X - ${t.keyword}]\n` +
        posts.slice(0, 5).map(p => `- ${p.text || p.title || ''}`).join('\n');
    }
  }).join('\n\n');
}
