const axios    = require('axios');
const FormData = require('form-data');
const { randomBytes } = require('crypto');

function normaliseBaseUrl(url) { return url.replace(/\/+$/, ''); }
function generateSessionHash() { return randomBytes(8).toString('hex'); }
function mimeToFilename(mimeType) {
  const ext = mimeType.split('/')[1]?.split('+')[0] || 'jpg';
  return `image.${ext}`;
}

async function detectFnIndex(hfUrl) {
  if (process.env.HF_FN_INDEX !== undefined) {
    const override = Number(process.env.HF_FN_INDEX);
    console.log(`[HF] fn_index from HF_FN_INDEX env: ${override}`);
    return override;
  }
  try {
    const { data: info } = await axios.get(`${hfUrl}/gradio_api/info`, { timeout: 10000 });
    const unnamed = info.unnamed_endpoints || {};
    const IMAGE_KEYWORDS = ['image', 'pil', 'filepath', 'numpy'];
    for (const [index, endpoint] of Object.entries(unnamed)) {
      const hasImage = (endpoint.parameters || []).some((p) => {
        const c = (p?.component || '').toLowerCase();
        const t = (p?.type?.type || p?.python_type?.type || '').toLowerCase();
        const d = (p?.type?.description || '').toLowerCase();
        return IMAGE_KEYWORDS.some(k => c.includes(k) || t.includes(k)) || d.includes('image') || d.includes('pil');
      });
      if (hasImage) { console.log(`[HF] Auto-detected fn_index=${index}`); return Number(index); }
    }
    console.warn('[HF] Could not auto-detect fn_index — falling back to 0.');
  } catch (err) {
    console.warn(`[HF] /gradio_api/info failed: ${err.message} — using fn_index=0`);
  }
  return 0;
}

async function uploadImage(hfUrl, imageBuffer, mimeType, filename) {
  const uploadUrl = `${hfUrl}/gradio_api/upload`;
  console.log(`[HF] Uploading image → ${uploadUrl} (${imageBuffer.length} bytes)`);
  const form = new FormData();
  form.append('files', imageBuffer, { filename: filename || mimeToFilename(mimeType), contentType: mimeType });
  const { data } = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(), timeout: 30000, maxBodyLength: Infinity,
  });
  const first = Array.isArray(data) ? data[0] : data;
  if (!first) throw new Error('Gradio upload returned an empty response.');
  if (typeof first === 'string') {
    return { path: first, orig_name: filename || mimeToFilename(mimeType), size: imageBuffer.length, mime_type: mimeType };
  }
  return first;
}

async function waitForResult(sseUrl) {
  // Open the SSE stream before entering the Promise constructor to avoid
  // the async-executor anti-pattern (unhandled rejections after an await).
  let response;
  try {
    response = await axios.get(sseUrl, { responseType: 'stream', headers: { Accept: 'text/event-stream' }, timeout: 120000 });
  } catch (err) {
    throw new Error(`Could not open SSE stream: ${err.message}`);
  }

  return new Promise((resolve, reject) => {
    let buffer = '', settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      response.data.destroy();
      err ? reject(err) : resolve(value);
    };
    response.data.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const parts = buffer.split(/\n\n/);
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        let json;
        try { json = JSON.parse(line.slice(6)); } catch { continue; }
        console.log(`[HF SSE] msg=${json.msg}`);
        if (json.msg === 'process_completed') return done(null, json);
        if (json.msg === 'queue_full') return done(new Error('Hugging Face Space queue is full. Please try again in a moment.'));
      }
    });
    response.data.on('error', err => done(new Error(`SSE stream error: ${err.message}`)));
    response.data.on('end', () => { if (!settled) done(new Error('SSE stream ended before inference completed.')); });
  });
}

async function predictReefHealth(imageBuffer, mimeType, originalName) {
  const rawUrl = process.env.HF_SPACE_URL;
  if (!rawUrl) throw new Error('HF_SPACE_URL is not defined in environment variables.');
  const hfUrl = normaliseBaseUrl(rawUrl);
  const fnIndex = await detectFnIndex(hfUrl);
  const fileRef = await uploadImage(hfUrl, imageBuffer, mimeType, originalName);
  console.log(`[HF] Upload complete — path: ${fileRef.path}`);
  const sessionHash = generateSessionHash();
  const joinUrl = `${hfUrl}/gradio_api/queue/join`;
  const triggerIdRaw = process.env.HF_TRIGGER_ID;
  const triggerId = triggerIdRaw !== undefined ? Number(triggerIdRaw) : null;
  console.log(`[HF] Joining queue → (fn_index=${fnIndex}, session=${sessionHash})`);
  const joinRes = await axios.post(joinUrl,
    { data: [fileRef], fn_index: fnIndex, trigger_id: triggerId, session_hash: sessionHash },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
  );
  console.log(`[HF] Queued — event_id: ${joinRes.data.event_id}`);
  const sseUrl = `${hfUrl}/gradio_api/queue/data?session_hash=${sessionHash}`;
  const event = await waitForResult(sseUrl);
  if (!event.success) {
    const errDetail = event.output?.error;
    if (!errDetail) throw new Error(`Inference failed with no error message (fn_index=${fnIndex}).`);
    throw new Error(`Hugging Face inference error: ${errDetail}`);
  }
  const outputData = event.output?.data;
  if (!Array.isArray(outputData) || outputData.length < 2) {
    throw new Error(`Unexpected output shape from Space: ${JSON.stringify(event.output)}`);
  }
  const [annotatedImageRaw, stats] = outputData;
  let annotatedImage;
  if (typeof annotatedImageRaw === 'string') {
    annotatedImage = annotatedImageRaw.includes(',') ? annotatedImageRaw.split(',')[1] : annotatedImageRaw;
  } else if (annotatedImageRaw?.url) {
    const imgRes = await axios.get(annotatedImageRaw.url, { responseType: 'arraybuffer', timeout: 30000 });
    annotatedImage = Buffer.from(imgRes.data).toString('base64');
  } else if (annotatedImageRaw?.path) {
    const fileUrl = `${hfUrl}/gradio_api/file=${annotatedImageRaw.path}`;
    const imgRes = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
    annotatedImage = Buffer.from(imgRes.data).toString('base64');
  } else {
    throw new Error(`Cannot decode annotated image from output: ${JSON.stringify(annotatedImageRaw)}`);
  }
  console.log(`[HF] Inference complete ✓ (fn_index=${fnIndex})`);
  return {
    annotatedImage,
    stats: {
      coral_detected:       Number(stats.coral_detected),
      bleaching_detected:   Number(stats.bleaching_detected),
      bleaching_percentage: Number(stats.bleaching_percentage),
    },
  };
}

module.exports = { predictReefHealth };
