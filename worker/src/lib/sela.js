// Sela Network 스크래핑 API 클라이언트

async function scrape(env, payload) {
  const res = await fetch(env.SELA_API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SELA_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 429) {
    const body = await res.json();
    const retryAfterSeconds = Math.ceil((body?.data?.resetIn ?? 10000) / 1000) + 2;
    const err = new Error(`Sela rate limit. Retry after ${retryAfterSeconds}s`);
    err.retryAfterSeconds = retryAfterSeconds;
    err.isRateLimit = true;
    throw err;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sela API error (${res.status}): ${err}`);
  }

  return res.json();
}

// API 호출 사이 딜레이 (rate limit 방지)
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function timeout(env) {
  return parseInt(env.SELA_TIMEOUT_MS, 10) || 60000;
}

// Google 뉴스/검색 스크래핑
export async function googleSearch(env, query) {
  await delay(2000); // rate limit 방지
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws`;
  return scrape(env, {
    url,
    scrapeType: 'HTML',
    timeoutMs: timeout(env),
  });
}

// Twitter 프로필 스크래핑
export async function scrapeTwitterProfile(env, username, postCount = 10) {
  return scrape(env, {
    url: `https://twitter.com/${username}`,
    scrapeType: 'TWITTER_PROFILE',
    postCount,
    timeoutMs: timeout(env),
    scrollPauseTime: 2000,
  });
}

// Twitter 포스트 스크래핑
export async function scrapeTwitterPost(env, postUrl, replyCount = 5) {
  return scrape(env, {
    url: postUrl,
    scrapeType: 'TWITTER_POST',
    replyCount,
    timeoutMs: timeout(env),
    scrollPauseTime: 2000,
  });
}
