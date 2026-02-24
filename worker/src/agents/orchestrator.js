// Orchestrator Agent
// 역할: 작업 시작, 에이전트 체인 시동

import { createClient } from '../lib/supabase.js';

export async function runOrchestrator(env, message) {
  const { jobId, twitterAccounts = [] } = message;
  const db = createClient(env);

  const [run] = await db.insert('agent_runs', {
    job_id: jobId,
    agent_name: 'orchestrator',
    status: 'running',
    input: { jobId },
    started_at: new Date().toISOString(),
  });

  try {
    const jobs = await db.select('jobs', { id: `eq.${jobId}` });
    const job = jobs[0];
    if (!job) throw new Error(`Job not found: ${jobId}`);

    // 작업 상태 running으로 변경
    await db.update('jobs', { status: 'running' }, { id: `eq.${jobId}` });

    await db.update('agent_runs', {
      status: 'done',
      output: { dispatched: 'trend_scout' },
      finished_at: new Date().toISOString(),
    }, { id: `eq.${run.id}` });

    // Trend Scout Queue로 전달
    await env.TREND_SCOUT_QUEUE.send({
      jobId,
      keywords: job.keywords,
      twitterAccounts,
    });

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
