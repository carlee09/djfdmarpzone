// Viral Content Agents - Main Worker Entry Point
// HTTP API + Queue Consumer 통합

import { runOrchestrator } from './agents/orchestrator.js';
import { runTrendScout } from './agents/trend-scout.js';
import { runAnalyst } from './agents/analyst.js';
import { runCopywriter } from './agents/copywriter.js';
import { runQAReviewer } from './agents/qa-reviewer.js';
import { createClient } from './lib/supabase.js';

// ───────────────────────────────────────────
// HTTP API 핸들러
// ───────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS 헤더
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const respond = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    const db = createClient(env);

    try {
      // POST /api/jobs - 새 작업 생성
      if (method === 'POST' && path === '/api/jobs') {
        const body = await request.json();
        const { goal, keywords = [], twitterAccounts = [] } = body;

        if (!goal) return respond({ error: 'goal is required' }, 400);

        const [job] = await db.insert('jobs', {
          goal,
          keywords,
          status: 'pending',
        });

        // Orchestrator Queue로 전달
        await env.ORCHESTRATOR_QUEUE.send({ jobId: job.id, twitterAccounts });

        return respond({ jobId: job.id, status: 'pending' });
      }

      // GET /api/jobs - 작업 목록
      if (method === 'GET' && path === '/api/jobs') {
        const jobs = await db.select('jobs', {}, '*');
        return respond(jobs);
      }

      // GET /api/jobs/:id - 작업 상태 조회
      const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
      if (method === 'GET' && jobMatch) {
        const jobId = jobMatch[1];
        const jobs = await db.select('jobs', { id: `eq.${jobId}` });
        if (!jobs.length) return respond({ error: 'Job not found' }, 404);
        return respond(jobs[0]);
      }

      // GET /api/jobs/:id/content - 생성된 콘텐츠 조회
      const contentMatch = path.match(/^\/api\/jobs\/([^/]+)\/content$/);
      if (method === 'GET' && contentMatch) {
        const jobId = contentMatch[1];
        const contents = await db.select('contents', { job_id: `eq.${jobId}` });
        return respond(contents);
      }

      // POST /api/jobs/:id/approve - 콘텐츠 승인
      const approveMatch = path.match(/^\/api\/jobs\/([^/]+)\/approve$/);
      if (method === 'POST' && approveMatch) {
        const jobId = approveMatch[1];
        const body = await request.json();
        const { contentId } = body;

        await db.update('contents', {
          approved_at: new Date().toISOString(),
        }, { id: `eq.${contentId}` });

        await db.update('jobs', { status: 'approved' }, { id: `eq.${jobId}` });

        return respond({ success: true, message: '승인 완료. 발행 준비됨.' });
      }

      // POST /api/jobs/:id/reject - 콘텐츠 반려
      const rejectMatch = path.match(/^\/api\/jobs\/([^/]+)\/reject$/);
      if (method === 'POST' && rejectMatch) {
        const jobId = rejectMatch[1];
        await db.update('jobs', { status: 'rejected' }, { id: `eq.${jobId}` });
        return respond({ success: true, message: '반려 완료.' });
      }

      return respond({ error: 'Not found' }, 404);

    } catch (err) {
      console.error('API error:', err);
      return respond({ error: err.message }, 500);
    }
  },

  // ───────────────────────────────────────────
  // Queue Consumer 핸들러
  // ───────────────────────────────────────────
  async queue(batch, env) {
    const queueName = batch.queue;

    for (const message of batch.messages) {
      try {
        console.log(`[${queueName}] Processing:`, JSON.stringify(message.body));

        switch (queueName) {
          case 'orchestrator-queue':
            await runOrchestrator(env, message.body);
            break;
          case 'trend-scout-queue':
            await runTrendScout(env, message.body);
            break;
          case 'analyst-queue':
            await runAnalyst(env, message.body);
            break;
          case 'copywriter-queue':
            await runCopywriter(env, message.body);
            break;
          case 'qa-queue':
            await runQAReviewer(env, message.body);
            break;
          default:
            console.error(`Unknown queue: ${queueName}`);
        }

        message.ack();
      } catch (err) {
        console.error(`[${queueName}] Error:`, err.message);
        // Rate limit 에러는 지연 재시도 (Gemini/Sela 429)
        if (err.isRateLimit && err.retryAfterSeconds) {
          message.retry({ delaySeconds: err.retryAfterSeconds });
        } else {
          message.retry();
        }
      }
    }
  },
};
