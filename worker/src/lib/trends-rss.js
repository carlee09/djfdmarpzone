// 실시간 IT 뉴스 RSS 파서
// ZDNet Korea (한국 IT 뉴스) + Hacker News (글로벌 테크 트렌드)

const SOURCES = [
  { name: 'ZDNet Korea', url: 'https://feeds.feedburner.com/zdkorea' },
  { name: 'Hacker News',  url: 'https://hnrss.org/frontpage' },
];

export async function fetchTrendingTopics(limit = 15) {
  const results = await Promise.allSettled(
    SOURCES.map(s => fetchRSS(s.url, s.name))
  );

  const allTitles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // 중복 제거 후 limit 개수만큼 반환
  return [...new Set(allTitles)].slice(0, limit);
}

async function fetchRSS(url, name) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];

    const xml = await res.text();

    // CDATA 형식: <title><![CDATA[제목]]></title>
    const cdataMatches = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)];
    if (cdataMatches.length > 0) {
      return cdataMatches.map(m => m[1].trim()).slice(0, 10);
    }

    // 일반 형식: <title>제목</title> (첫 번째는 채널명이므로 skip)
    const plainMatches = [...xml.matchAll(/<title>(.*?)<\/title>/g)];
    return plainMatches.map(m => m[1].trim()).slice(1, 11);

  } catch (err) {
    console.error(`RSS fetch error (${name}):`, err.message);
    return [];
  }
}
