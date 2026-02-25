// QA Reviewer Agent
// 역할: 콘텐츠 검토, 점수 산정, 최종 선정 + Telegram 알림

import { callGeminiJSON } from '../lib/gemini.js';
import { sendMessage, sendMessageWithButtons } from '../lib/telegram.js';
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
    const contents = await db.select('contents', { job_id: `eq.${jobId}` });
    const reviews = [];

    for (const content of contents) {
      const ruleViolations = checkRules(content.body);
      let score = 0;
      let feedback = '';

      if (ruleViolations.length > 0) {
        score = 0;
        feedback = `규칙 위반: ${ruleViolations.join(', ')}`;
      } else {
        const result = await scoreContent(env.GEMINI_API_KEY, content.body);
        score = result.score;
        feedback = result.feedback;
      }

      await db.update('contents', {
        viral_score: score,
        qa_feedback: feedback,
      }, { id: `eq.${content.id}` });

      reviews.push({ id: content.id, variantNum: content.variant_num, score, feedback, body: content.body });
    }

    const best = reviews.sort((a, b) => b.score - a.score)[0];

    if (best && best.score >= 60) {
      await db.update('contents', { is_selected: true }, { id: `eq.${best.id}` });
      await db.update('jobs', { status: 'awaiting_approval' }, { id: `eq.${jobId}` });

      // Telegram 알림 전송
      await notifyTelegram(env, jobId, best);
    } else {
      await db.update('jobs', { status: 'failed' }, { id: `eq.${jobId}` });

      await sendMessage(
        env.TELEGRAM_TOKEN,
        env.TELEGRAM_CHAT_ID,
        `❌ <b>콘텐츠 생성 실패</b>\n\nJob ID: <code>${jobId}</code>\n모든 variant가 60점 미만입니다. 목표를 수정하거나 재시도해주세요.`
      );
    }

    await db.update('agent_runs', {
      status: 'done',
      output: { reviews: reviews.map(r => ({ variantNum: r.variantNum, score: r.score })), selectedId: best?.id },
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

async function notifyTelegram(env, jobId, best) {
  const charCount = best.body.length;

  const msg = `
🎯 <b>콘텐츠 승인 요청</b>

📊 바이럴 점수: <b>${best.score}점</b>
📝 글자 수: ${charCount}/280자

──────────────────
${best.body}
──────────────────
`.trim();

  // callback_data는 Telegram 64바이트 제한 — contentId는 webhook에서 DB 조회
  const buttons = [[
    { text: '✅ 승인', callback_data: `approve:${jobId}` },
    { text: '❌ 반려', callback_data: `reject:${jobId}` },
  ]];

  await sendMessageWithButtons(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, msg, buttons);
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

반드시 0에서 100 사이의 정수로 점수를 매겨주세요.
다음 JSON 스키마로 응답하세요:
{ "score": integer (0-100), "feedback": string }
`;

  try {
    const { data } = await callGeminiJSON(apiKey, prompt);
    let score = data.score ?? 0;
    if (score <= 10) score = score * 10;
    return { score, feedback: data.feedback ?? '' };
  } catch {
    return { score: 50, feedback: '자동 평가 실패, 수동 검토 필요' };
  }
}
