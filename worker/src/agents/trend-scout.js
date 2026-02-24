// Trend Scout Agent
// 역할: Google Search + X 스크래핑으로 트렌드 수집

import { googleSearch, scrapeTwitterProfile } from '../lib/sela.js';
import { createClient } from '../lib/supabase.js';

export async function runTrendScout(env, message) {
  const { jobId, keywords, twitterAccounts = [] } = message;
  const db = createClient(env);

  // agent_runs 시작 기록
  const [run] = await db.insert('agent_runs', {
    job_id: jobId,
    agent_name: 'trend_scout',
    status: 'running',
    input: { keywords, twitterAccounts },
    started_at: new Date().toISOString(),
  });

  try {
    const trends = [];

    // 1. Google 뉴스 검색 - 각 키워드 트렌드 수집
    for (const keyword of keywords) {
      const result = await googleSearch(env, keyword);
      const items = extractGoogleResults(result);

      await db.insert('trends', {
        job_id: jobId,
        source: 'google',
        keyword,
        engagement_score: items.length,
        raw_data: { items, raw: result },
        collected_at: new Date().toISOString(),
      });

      trends.push({ source: 'google', keyword, items });
    }

    // 2. X 스크래핑 - 지정된 계정 최신 포스트 수집
    for (const username of twitterAccounts) {
      const result = await scrapeTwitterProfile(env, username, 20);
      const posts = extractTwitterPosts(result);

      await db.insert('trends', {
        job_id: jobId,
        source: 'x',
        keyword: username,
        engagement_score: calcEngagement(posts),
        raw_data: { posts },
        collected_at: new Date().toISOString(),
      });

      trends.push({ source: 'x', username, posts });
    }

    // 3. X 바이럴 검색 (Google 뉴스로 Twitter 콘텐츠 탐색)
    for (const keyword of keywords) {
      const result = await googleSearch(env, `site:twitter.com ${keyword}`);
      const items = extractGoogleResults(result);

      await db.insert('trends', {
        job_id: jobId,
        source: 'x',
        keyword: `twitter:${keyword}`,
        engagement_score: items.length,
        raw_data: { items },
        collected_at: new Date().toISOString(),
      });
    }

    // agent_runs 완료 기록
    await db.update('agent_runs', {
      status: 'done',
      output: { trendsCollected: trends.length },
      finished_at: new Date().toISOString(),
    }, { id: `eq.${run.id}` });

    // Analyst Queue로 전달
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

function extractGoogleResults(raw) {
  if (!raw) return [];
  const results = raw?.organic_results || raw?.results || [];
  return results.slice(0, 10).map(r => ({
    title: r.title,
    snippet: r.snippet,
    link: r.link,
  }));
}

function extractTwitterPosts(raw) {
  if (!raw) return [];
  const posts = raw?.posts || raw?.tweets || [];
  return posts.slice(0, 20).map(p => ({
    text: p.text || p.content,
    likes: p.likes || p.favorite_count || 0,
    retweets: p.retweets || p.retweet_count || 0,
    replies: p.replies || p.reply_count || 0,
  }));
}

function calcEngagement(posts) {
  if (!posts.length) return 0;
  const total = posts.reduce((sum, p) => sum + (p.likes || 0) + (p.retweets || 0) * 2, 0);
  return total / posts.length;
}
