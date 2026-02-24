// Gemini 2.0 Flash API 클라이언트

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function callGemini(apiKey, prompt, systemPrompt = null) {
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];

  const body = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const data = await res.json();
    const retryDelayStr = data?.error?.details?.find(d => d.retryDelay)?.retryDelay ?? '60s';
    const retrySeconds = parseInt(retryDelayStr) || 60;
    const err = new Error(`Gemini rate limit. Retry after ${retrySeconds}s`);
    err.retryAfterSeconds = retrySeconds + 5;
    err.isRateLimit = true;
    throw err;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const tokensUsed = data.usageMetadata?.totalTokenCount ?? 0;

  return { text, tokensUsed };
}

export async function callGeminiJSON(apiKey, prompt, systemPrompt = null) {
  const { text, tokensUsed } = await callGemini(apiKey, prompt, systemPrompt);

  // JSON 블록 파싱 (```json ... ``` 형태 처리)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                    text.match(/```\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text.trim();

  try {
    return { data: JSON.parse(jsonStr), tokensUsed };
  } catch {
    throw new Error(`Gemini JSON parse error. Raw: ${text}`);
  }
}
