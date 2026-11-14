// Fire Harmony "Ask" relay on Google Apps Script (free; runs on Google's servers, where the Gemini API always answers).
// Setup: script.google.com > New project > paste this file > Project Settings > Script properties: GEMINI_API_KEY =
// your key > Deploy > New deployment > Web app (Execute as: Me; Who has access: Anyone) > copy the /exec URL.
// The models, rules and tools come from the site (assistant.json), so they change with the app, not here.
const CONFIG_URL = 'https://warren-530.github.io/fire-harmony/assistant.json';

function config_() {
  const cache = CacheService.getScriptCache();
  let s = cache.get('cfg');
  if (!s) { s = UrlFetchApp.fetch(CONFIG_URL, { muteHttpExceptions: true }).getContentText(); cache.put('cfg', s, 600); }
  return JSON.parse(s);
}

function doGet() { return out_({ ok: true, models: config_().models }); }

function doPost(e) {
  let contents;
  try {
    const raw = e.postData.contents;
    contents = JSON.parse(raw).contents;
    if (!Array.isArray(contents) || !contents.length || contents.length > 48 || raw.length > 120000) throw new Error('bad');
  } catch (x) { return out_({ error: 'bad request' }); }
  const cfg = config_(), cache = CacheService.getScriptCache();
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: cfg.system }] }, contents: contents,
    tools: [{ functionDeclarations: cfg.tools }], generationConfig: { thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 2048 } });
  let daily = true;
  for (const m of cfg.models) {          // each free model has its own quota: a used up one is skipped until it resets
    const used = cache.get('out:' + m);
    if (used) { if (used !== 'day') daily = false; continue; }
    const t0 = Date.now();
    let r;
    try {
      r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent',
        { method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: body, muteHttpExceptions: true });
    } catch (x) { r = null; }
    // a model that hangs or fails on the way is skipped for 30 minutes, so the next question goes straight to the others
    if (!r || Date.now() - t0 > 20000) cache.put('out:' + m, 'slow', 1800);
    if (!r) { daily = false; continue; }
    const code = r.getResponseCode(), text = r.getContentText();
    if (code === 429 || code === 503) {
      const perDay = text.indexOf('PerDay') >= 0, wait = Number((text.match(/"retryDelay":\s*"(\d+)s"/) || [])[1] || 60);
      cache.put('out:' + m, perDay ? 'day' : 'minute', Math.min(Math.max(wait, perDay ? 600 : 30), 21600));
      if (!perDay) daily = false;
      continue;
    }
    if (code !== 200) return out_({ error: 'model', status: code });
    const d = JSON.parse(text), cand = (d.candidates || [{}])[0];
    return cand.content ? out_({ content: cand.content, finish: cand.finishReason || null }) : out_({ error: 'empty' });
  }
  return out_({ error: daily ? 'quota' : 'busy' });
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
