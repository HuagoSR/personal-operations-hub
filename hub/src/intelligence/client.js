'use strict';
const { ANALYSIS_SCHEMA_VERSION } = require('./schema');

// IntelligenceModelClient abstraction (D018):
//   analyze({ messages, provider, model, options }) -> { ok, output?, raw?, error?, latencyMs, usage?, estimatedCost? }
// v1 providers: 'stub' (offline/dev/eval) and OpenAI-compatible HTTP (DeepSeek endpoint).
// The DeepSeek client is implemented but MUST NOT be invoked until the user approves real egress (7B).

function createStubClient(responder) {
  const respond = typeof responder === 'function' ? responder : defaultResponder;
  return {
    provider: 'stub',
    async analyze({ messages, options }) {
      const t0 = Date.now();
      const text = await respond(messages);
      return {
        ok: true,
        output: text,
        latencyMs: Date.now() - t0,
        usage: null,
        estimatedCost: 0,
      };
    },
  };
}

function defaultResponder() {
  return JSON.stringify({
    summary: 'stub analysis',
    importance: 'LOW',
    urgency: 'LOW',
    requires_action: false,
    intent: 'SOCIAL',
    deadline: { text: null, resolved: null },
    suggested_project: { project_id: null, confidence: null },
    suggested_task: { title: null, description: null, confidence: null },
    reason_codes: [],
    evidence_refs: [],
    risk_flags: [],
    confidence: 0.1,
  });
}

function createOpenAICompatibleClient(cfg) {
  return {
    provider: cfg.intelligenceProvider || 'deepseek',
    async analyze({ messages, model, options }) {
      const t0 = Date.now();
      const apiKey = (options && options.apiKey)
        || cfg.intelligenceApiKey
        || (cfg.intelligenceApiKeyEnv ? process.env[cfg.intelligenceApiKeyEnv] : '')
        || '';
      if (!apiKey) return { ok: false, error: 'intelligence api key not configured', latencyMs: Date.now() - t0 };
      const res = await fetch(`${cfg.intelligenceApiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || cfg.intelligenceModel || 'deepseek-chat',
          messages,
          response_format: { type: 'json_object' },
          temperature: 0,
        }),
      });
      if (!res.ok) {
        return { ok: false, error: `provider http ${res.status}: ${(await res.text()).slice(0, 200)}`, latencyMs: Date.now() - t0 };
      }
      const data = await res.json();
      const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : null;
      if (!content) return { ok: false, error: 'provider returned empty content', latencyMs: Date.now() - t0 };
      return {
        ok: true,
        output: content,
        latencyMs: Date.now() - t0,
        usage: data.usage || null,
        estimatedCost: estimateCost(model || cfg.intelligenceModel, data.usage || null),
      };
    },
  };
}

function estimateCost(model, usage) {
  if (!usage) return null;
  // rough DeepSeek pricing ($/1M tokens): input 0.27, output 1.10 (deepseek-chat)
  const p = model === 'deepseek-chat'
    ? { in: 0.27e-6, out: 1.10e-6 }
    : { in: 0.55e-6, out: 2.19e-6 };
  return Number(((usage.prompt_tokens || 0) * p.in + (usage.completion_tokens || 0) * p.out).toFixed(6));
}

function createClient(cfg, { responder } = {}) {
  const provider = (cfg.intelligenceProvider || 'stub').toLowerCase();
  if (provider === 'stub') return createStubClient(responder);
  return createOpenAICompatibleClient(cfg);
}

module.exports = {
  createClient,
  createStubClient,
  createOpenAICompatibleClient,
  estimateCost,
  ANALYSIS_SCHEMA_VERSION,
};
