// Copywriter Agent
// 역할: 분석 결과를 바탕으로 X 포스트 3개 초안 생성

import { callGeminiJSON } from '../lib/gemini.js';
import { createClient } from '../lib/supabase.js';
import { getPreferenceContext } from '../lib/preferences.js';

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
    const [job, { profile, approvedExamples }] = await Promise.all([
      db.select('jobs', { id: `eq.${jobId}` }),
      getPreferenceContext(env, db),
    ]);

    // 선호도 프로필 섹션 (데이터 있을 때만 포함)
    const preferenceSection = buildPreferenceSection(profile, approvedExamples);

    const prompt = `
당신은 X(Twitter) 바이럴 콘텐츠 전문 카피라이터입니다.
아래 전략을 바탕으로 X 포스트 초안 3개를 작성하세요.

목표: ${job[0]?.goal}
${preferenceSection}
콘텐츠 전략:
- 핵심 토픽: ${analysis.topTopics?.join(', ')}
- 바이럴 트리거: ${analysis.viralTriggers?.join(', ')}
- 유발 감정: ${analysis.targetEmotion}
- 콘텐츠 각도: ${analysis.contentAngle}
- 훅 스타일: ${analysis.hookStyle}
- 방향: ${analysis.contentBrief}

CRITICAL RULES (violations will disqualify the post):
1. ABSOLUTELY NO EMOJI CHARACTERS - not a single one (no 😀🎯✅❌🔥💡📊 or any unicode emoji)
2. NO HASHTAGS (#) whatsoever
3. Each post MUST be 280 characters or less (including spaces)
4. Write in Korean
5. Each post must start with a different hook (first sentence)
6. Use only plain text: Korean/English letters, numbers, punctuation (.,!?:;) and spaces only

다음 JSON 스키마로 응답하세요:
{
  "variants": [
    { "variantNum": 1, "body": string, "hookType": string },
    { "variantNum": 2, "body": string, "hookType": string },
    { "variantNum": 3, "body": string, "hookType": string }
  ]
}
`;

    const { data: result, tokensUsed } = await callGeminiJSON(env.GEMINI_API_KEY, prompt);

    // 3개 variants Supabase에 저장 (이모지/해시태그 후처리 제거)
    for (const v of result.variants) {
      const cleanBody = stripForbidden(v.body);
      await db.insert('contents', {
        job_id: jobId,
        variant_num: v.variantNum,
        body: cleanBody,
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

// 선호도 프로필 → 프롬프트 섹션 생성
function buildPreferenceSection(profile, approvedExamples) {
  if (!profile && !approvedExamples?.length) return '';

  const lines = ['\n사용자 선호도 (학습된 데이터 기반):'];

  if (profile?.styleGuide) {
    lines.push(`스타일 가이드: ${profile.styleGuide}`);
  }
  if (profile?.preferredHookStyles?.length) {
    lines.push(`선호 훅 스타일: ${profile.preferredHookStyles.join(', ')}`);
  }
  if (profile?.preferredTones?.length) {
    lines.push(`선호 톤: ${profile.preferredTones.join(', ')}`);
  }
  if (profile?.avoidStyles?.length) {
    lines.push(`피할 스타일: ${profile.avoidStyles.join(', ')}`);
  }
  if (profile?.sampleCount) {
    lines.push(`(${profile.sampleCount}개 피드백 기반)`);
  }

  if (approvedExamples?.length) {
    lines.push('\n과거 승인된 포스트 예시 (이 스타일을 참고하세요):');
    approvedExamples.forEach((ex, i) => {
      lines.push(`예시 ${i + 1}: "${ex.body}"`);
    });
  }

  return lines.join('\n');
}

// 이모지 및 해시태그 제거 후처리
function stripForbidden(text) {
  // Remove all emoji (Unicode ranges)
  let clean = text.replace(/\p{Emoji}/gu, '');
  // Remove hashtags
  clean = clean.replace(/#\S+/g, '');
  // Collapse multiple spaces/newlines left after removal
  clean = clean.replace(/[ \t]+/g, ' ').trim();
  return clean;
}
