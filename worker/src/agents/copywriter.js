// Copywriter Agent
// 역할: 분석 결과를 바탕으로 X 포스트 3개 초안 생성

import { callGeminiJSON } from '../lib/gemini.js';
import { createClient } from '../lib/supabase.js';

export async function runCopywriter(env, message) {
  const { jobId, analysis } = message;
  const db = createClient(env);

  const [run] = await db.insert('agent_runs', {
    job_id: jobId,
    agent_name: 'copywriter',
    status: 'running',
    input: { analysis },
    started_at: new Date().toISOString(),
  });

  try {
    const job = await db.select('jobs', { id: `eq.${jobId}` });

    const prompt = `
당신은 X(Twitter) 바이럴 콘텐츠 전문 카피라이터입니다.
아래 전략을 바탕으로 X 포스트 초안 3개를 작성하세요.

목표: ${job[0]?.goal}

콘텐츠 전략:
- 핵심 토픽: ${analysis.topTopics?.join(', ')}
- 바이럴 트리거: ${analysis.viralTriggers?.join(', ')}
- 유발 감정: ${analysis.targetEmotion}
- 콘텐츠 각도: ${analysis.contentAngle}
- 훅 스타일: ${analysis.hookStyle}
- 방향: ${analysis.contentBrief}

엄격한 규칙:
1. 이모지 절대 사용 금지
2. 해시태그(#) 절대 사용 금지
3. 각 포스트는 반드시 280자 이하 (공백 포함)
4. 한국어로 작성
5. 각 포스트는 서로 다른 훅(첫 문장)으로 시작

다음 JSON 형식으로 반환하세요:
\`\`\`json
{
  "variants": [
    {
      "variantNum": 1,
      "body": "포스트 전체 내용",
      "hookType": "사용한 훅 유형"
    },
    {
      "variantNum": 2,
      "body": "포스트 전체 내용",
      "hookType": "사용한 훅 유형"
    },
    {
      "variantNum": 3,
      "body": "포스트 전체 내용",
      "hookType": "사용한 훅 유형"
    }
  ]
}
\`\`\`
`;

    const { data: result, tokensUsed } = await callGeminiJSON(env.GEMINI_API_KEY, prompt);

    // 3개 variants Supabase에 저장
    for (const v of result.variants) {
      await db.insert('contents', {
        job_id: jobId,
        variant_num: v.variantNum,
        body: v.body,
        viral_score: 0,
        is_selected: false,
      });
    }

    await db.update('agent_runs', {
      status: 'done',
      output: result,
      tokens_used: tokensUsed,
      finished_at: new Date().toISOString(),
    }, { id: `eq.${run.id}` });

    // QA Queue로 전달
    await env.QA_QUEUE.send({ jobId });

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
