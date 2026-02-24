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

다음 JSON 형식으로 분석 결과를 반환하세요:
\`\`\`json
{
  "topTopics": ["주요 토픽 1", "주요 토픽 2", "주요 토픽 3"],
  "viralTriggers": ["감정적 반응", "정보 충격", "논쟁 유발" 등 감지된 바이럴 트리거],
  "targetEmotion": "콘텐츠가 유발해야 할 주요 감정",
  "contentAngle": "차별화된 콘텐츠 각도/관점",
  "hookStyle": "첫 문장 스타일 (예: 반전, 질문, 주장, 수치 등)",
  "avoidTopics": ["피해야 할 소재나 표현"],
  "contentBrief": "Copywriter에게 전달할 구체적인 콘텐츠 방향 (3-5문장)"
}
\`\`\`
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
