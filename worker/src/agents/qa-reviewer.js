// QA Reviewer Agent
// 역할: 콘텐츠 검토, 점수 산정, 최종 선정

import { callGeminiJSON } from '../lib/gemini.js';
import { createClient } from '../lib/supabase.js';

const MAX_CHARS = 280;

export async function runQAReviewer(env, message) {
  const { jobId } = message;
  const db = createClient(env);

  const [run] = await db.insert('agent_runs', {
    job_id: jobId,
    agent_name: 'qa_reviewer',
    status: 'running',
    input: { jobId },
    started_at: new Date().toISOString(),
  });

  try {
    // 생성된 콘텐츠 조회
    const contents = await db.select('contents', { job_id: `eq.${jobId}` });

    const reviews = [];

    for (const content of contents) {
      // 규칙 검사 (LLM 없이)
      const ruleViolations = checkRules(content.body);

      let score = 0;
      let feedback = '';

      if (ruleViolations.length > 0) {
        score = 0;
        feedback = `규칙 위반: ${ruleViolations.join(', ')}`;
      } else {
        // Gemini로 바이럴 점수 평가
        const result = await scoreContent(env.GEMINI_API_KEY, content.body);
        score = result.score;
        feedback = result.feedback;
      }

      // 점수 업데이트
      await db.update('contents', {
        viral_score: score,
        qa_feedback: feedback,
      }, { id: `eq.${content.id}` });

      reviews.push({ id: content.id, variantNum: content.variant_num, score, feedback });
    }

    // 최고 점수 콘텐츠 선정 (60점 이상이어야 선정)
    const best = reviews.sort((a, b) => b.score - a.score)[0];

    if (best && best.score >= 60) {
      await db.update('contents', { is_selected: true }, { id: `eq.${best.id}` });
      await db.update('jobs', { status: 'awaiting_approval' }, { id: `eq.${jobId}` });
    } else {
      // 모두 60점 미만이면 실패 처리
      await db.update('jobs', { status: 'failed' }, { id: `eq.${jobId}` });
    }

    await db.update('agent_runs', {
      status: 'done',
      output: { reviews, selectedId: best?.id, selectedScore: best?.score },
      finished_at: new Date().toISOString(),
    }, { id: `eq.${run.id}` });

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

function checkRules(body) {
  const violations = [];
  if (body.length > MAX_CHARS) violations.push(`${body.length}자 (280자 초과)`);
  if (/\p{Emoji}/u.test(body)) violations.push('이모지 포함');
  if (/#\S+/.test(body)) violations.push('해시태그 포함');
  return violations;
}

async function scoreContent(apiKey, body) {
  const prompt = `
다음 X(Twitter) 포스트의 바이럴 가능성을 평가하세요.

포스트:
"${body}"

평가 기준:
- 첫 문장의 흡입력 (훅)
- 감정적 반응 유발 여부
- 공유 욕구 자극
- 정보 가치 또는 오락성
- 전반적인 완성도

다음 JSON으로 반환하세요:
\`\`\`json
{
  "score": 0~100 사이 정수,
  "feedback": "개선 포인트나 강점을 2-3문장으로"
}
\`\`\`
`;

  try {
    const { data } = await callGeminiJSON(apiKey, prompt);
    return { score: data.score ?? 0, feedback: data.feedback ?? '' };
  } catch {
    return { score: 50, feedback: '자동 평가 실패, 수동 검토 필요' };
  }
}
