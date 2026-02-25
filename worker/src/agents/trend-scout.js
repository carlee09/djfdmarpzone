// Trend Scout Agent
// 역할: 오케스트레이터 전략 기반으로 자율 검색 + 파생 키워드 2차 탐색

import { googleSearch, scrapeTwitterProfile } from '../lib/sela.js';
import { callGeminiJSON } from '../lib/gemini.js';
import { createClient } from '../lib/supabase.js';

export async function runTrendScout(env, message) {
  const { jobId, keywords, searchAngles = [], twitterAccounts = [] } = message;
  const db = createClient(env);

  const [run] = await db.insert('agent_runs', {
    job_id: jobId,
    agent_name: 'trend_scout',
    status: 'running',
    input: { keywords, searchAngles },
    started_at: new Date().toISOString(),
  });

  try {
    const allResults = [];

    // ── 1라운드: 오케스트레이터가 결정한 키워드 검색 ──
    for (const keyword of keywords) {
      const result = await googleSearch(env, keyword);
      const items = extractItems(result);
      if (items.length > 0) {
        await db.insert('trends', {
          job_id: jobId,
          source: 'google',
          keyword,
          engagement_score: items.length,
          raw_data: { items },
          collected_at: new Date().toISOString(),
        });
        allResults.push({ keyword, items });
      }
    }

    // ── X 프로필 스크래핑 (계정 지정 시) ──
    for (const username of twitterAccounts) {
      const result = await scrapeTwitterProfile(env, username, 20);
      const posts = extractPosts(result);
      if (posts.length > 0) {
        await db.insert('trends', {
          job_id: jobId,
          source: 'x',
          keyword: username,
          engagement_score: calcEngagement(posts),
          raw_data: { posts },
          collected_at: new Date().toISOString(),
        });
        allResults.push({ keyword: `@${username}`, items: posts.map(p => ({ title: p.text })) });
      }
    }

    // ── 2라운드: 1차 결과 분석 → 파생 키워드 자율 결정 → 추가 검색 ──
    if (allResults.length > 0) {
      const summary = allResults
        .map(r => `[${r.keyword}]\n` + r.items.slice(0, 3).map(i => `- ${i.title || i.text || ''}`).join('\n'))
        .join('\n\n');

      const derivePrompt = `
아래는 1차 트렌드 수집 결과입니다.
이 결과를 분석해서 더 깊이 조사할 가치가 있는 파생 검색어 3개를 결정하세요.
기존 키워드와 겹치지 않는 새로운 각도의 키워드를 선택하세요.

1차 수집 결과:
${summary}

검색 방향 힌트: ${searchAngles.join(', ')}

다음 JSON 스키마로 응답하세요:
{ "derivedKeywords": string[] }
`;

      const { data } = await callGeminiJSON(env.GEMINI_API_KEY, derivePrompt);
      const derivedKeywords = data.derivedKeywords || [];

      for (const keyword of derivedKeywords) {
        const result = await googleSearch(env, keyword);
        const items = extractItems(result);
        if (items.length > 0) {
          await db.insert('trends', {
            job_id: jobId,
            source: 'google',
            keyword: `derived:${keyword}`,
            engagement_score: items.length,
            raw_data: { items },
            collected_at: new Date().toISOString(),
          });
        }
      }
    }

    await db.update('agent_runs', {
      status: 'done',
      output: { keywordsSearched: keywords.length, rounds: 2 },
      finished_at: new Date().toISOString(),
    }, { id: `eq.${run.id}` });

    await env.ANALYST_QUEUE.send({ jobId });

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

function extractItems(raw) {
  if (!raw) return [];
  const results = raw?.organic_results || raw?.results || [];
  return results.slice(0, 10).map(r => ({
    title: r.title,
    snippet: r.snippet,
    link: r.link,
  })).filter(r => r.title);
}

function extractPosts(raw) {
  if (!raw) return [];
  const posts = raw?.posts || raw?.tweets || [];
  return posts.slice(0, 20).map(p => ({
    text: p.text || p.content,
    likes: p.likes || p.favorite_count || 0,
    retweets: p.retweets || p.retweet_count || 0,
  }));
}

function calcEngagement(posts) {
  if (!posts.length) return 0;
  return posts.reduce((sum, p) => sum + (p.likes || 0) + (p.retweets || 0) * 2, 0) / posts.length;
}
