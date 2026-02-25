// Preference Learning
// 승인/반려 이력을 분석해 사용자 선호 프로필을 생성하고 KV에 저장

import { callGeminiJSON } from './gemini.js';

const KV_KEY = 'user_preference_profile';
const MIN_SAMPLES_FOR_ANALYSIS = 5; // 프로필 생성 시작 최소 샘플 수

// 피드백 발생 후 호출 — 프로필 업데이트 시도
export async function updatePreferences(env, db) {
  const approved = await getApprovedContents(db, 20);
  const rejected = await getRejectedContents(db, 20);
  const total = approved.length + rejected.length;

  // 샘플이 충분하면 Gemini로 프로필 분석
  if (total >= MIN_SAMPLES_FOR_ANALYSIS) {
    const profile = await analyzePreferences(env, approved, rejected);
    await env.CACHE.put(KV_KEY, JSON.stringify(profile));
  }
}

// Copywriter가 호출 — 현재 프로필 + 최근 승인 예시 반환
export async function getPreferenceContext(env, db) {
  const profileRaw = await env.CACHE.get(KV_KEY);
  const profile = profileRaw ? JSON.parse(profileRaw) : null;
  const approvedExamples = await getApprovedContents(db, 3);

  return { profile, approvedExamples };
}

// ── 내부 함수 ──────────────────────────────────────────

async function getApprovedContents(db, limit) {
  const rows = await db.select('contents', {
    approved_at: 'not.is.null',
    order: 'approved_at.desc',
    limit: String(limit),
  }, 'body,viral_score,approved_at');
  return rows;
}

async function getRejectedContents(db, limit) {
  // job status = rejected이고 is_selected = true인 콘텐츠 = 반려된 콘텐츠
  // Supabase REST는 join을 직접 지원하지 않으므로 jobs → contents 순으로 조회
  const rejectedJobs = await db.select('jobs', {
    status: 'eq.rejected',
    order: 'updated_at.desc',
    limit: String(limit),
  }, 'id');

  if (!rejectedJobs.length) return [];

  const jobIds = rejectedJobs.map(j => j.id);
  const results = [];

  for (const jobId of jobIds.slice(0, 10)) {
    const contents = await db.select('contents', {
      job_id: `eq.${jobId}`,
      is_selected: 'eq.true',
    }, 'body,viral_score');
    results.push(...contents);
  }
  return results;
}

async function analyzePreferences(env, approved, rejected) {
  const approvedSample = approved.slice(0, 10).map(c => c.body).join('\n\n---\n\n');
  const rejectedSample = rejected.slice(0, 10).map(c => c.body).join('\n\n---\n\n');

  const prompt = `
당신은 콘텐츠 선호도 분석 전문가입니다.
아래 승인된 X 포스트와 반려된 X 포스트를 분석하여 사용자의 선호 패턴을 파악하세요.

[승인된 포스트 ${approved.length}개 중 샘플]
${approvedSample || '(없음)'}

[반려된 포스트 ${rejected.length}개 중 샘플]
${rejectedSample || '(없음)'}

분석 후 다음 JSON 스키마로 응답하세요:
{
  "preferredHookStyles": string[],     // 선호하는 첫 문장 스타일 (예: "질문형", "선언형", "반전형")
  "preferredTones": string[],          // 선호하는 톤 (예: "실용적", "논쟁 유발", "공감형")
  "preferredTopicAngles": string[],    // 선호하는 주제 접근 방식
  "avoidStyles": string[],             // 피해야 할 스타일
  "styleGuide": string,                // 한 문단 스타일 가이드 요약
  "sampleCount": number                // 분석에 사용된 총 샘플 수
}
`;

  try {
    const { data } = await callGeminiJSON(env.GEMINI_API_KEY, prompt);
    return { ...data, sampleCount: approved.length + rejected.length, updatedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}
