const STORAGE_KEY = 'send-ft-demo-form';
const DEFAULT_FORM_STATE = {
  apiBase: 'http://127.0.0.1:3000',
  receiverId: '',
  amount: '1',
  memo: '',
};

const sendForm = document.querySelector('#send-form');
const responseEl = document.querySelector('#response');
const logEl = document.querySelector('#log');
const submitBtn = document.querySelector('#submit-btn');
const healthBtn = document.querySelector('#health-btn');
const rawResponseDetails = document.querySelector('#raw-response');
const rawResponseBody = document.querySelector('#raw-response-body');
const apiBaseInput = document.querySelector('#apiBase');
const receiverIdInput = document.querySelector('#receiverId');
const amountInput = document.querySelector('#amount');
const memoInput = document.querySelector('#memo');

function loadFormState() {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_FORM_STATE };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_FORM_STATE };
    }

    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_FORM_STATE,
      ...parsed,
    };
  } catch (error) {
    console.warn('Failed to load saved form state', error);
    return { ...DEFAULT_FORM_STATE };
  }
}

function saveFormState(state) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to persist form state', error);
  }
}

function getCurrentFormState() {
  return {
    apiBase: apiBaseInput.value.trim() || DEFAULT_FORM_STATE.apiBase,
    receiverId: receiverIdInput.value.trim(),
    amount: amountInput.value.toString(),
    memo: memoInput.value.trim(),
  };
}

function hydrateForm() {
  const state = loadFormState();
  apiBaseInput.value = state.apiBase;
  receiverIdInput.value = state.receiverId;
  amountInput.value = state.amount;
  memoInput.value = state.memo;
}

function persistForm() {
  saveFormState(getCurrentFormState());
}

function appendLog(message, status = 'info') {
  const li = document.createElement('li');
  const time = document.createElement('time');
  const now = new Date();
  time.textContent = now.toLocaleTimeString();
  time.dateTime = now.toISOString();

  const detail = document.createElement('span');
  detail.textContent = message;
  detail.className = status;

  li.appendChild(time);
  li.appendChild(detail);
  logEl.prepend(li);
}

function setResponse(content, { isError = false, raw } = {}) {
  responseEl.textContent = content;
  responseEl.dataset.state = isError ? 'error' : 'ok';

  if (typeof raw === 'string' && raw.length > 0) {
    rawResponseBody.textContent = raw;
    rawResponseDetails.hidden = false;
    rawResponseDetails.open = false;
  } else {
    rawResponseBody.textContent = '';
    rawResponseDetails.hidden = true;
    rawResponseDetails.open = false;
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.warn('Failed to stringify value', error);
    return String(value);
  }
}

function parseEventLogs(receiptsOutcome = []) {
  const totals = new Map();

  for (const receipt of receiptsOutcome) {
    const logs = receipt?.outcome?.logs || [];
    for (const logEntry of logs) {
      if (typeof logEntry !== 'string') continue;
      const marker = 'EVENT_JSON:';
      const idx = logEntry.indexOf(marker);
      if (idx === -1) continue;

      const payload = logEntry.slice(idx + marker.length);
      try {
        const parsed = JSON.parse(payload);
        const events = Array.isArray(parsed.data) ? parsed.data : [];
        for (const event of events) {
          const receiverId = event.new_owner_id ?? event.receiver_id;
          const amountRaw = event.amount;
          if (!receiverId || typeof amountRaw === 'undefined') continue;
          const previous = totals.get(receiverId) || 0n;
          totals.set(receiverId, previous + BigInt(amountRaw));
        }
      } catch (error) {
        console.warn('Failed to parse EVENT_JSON log', { logEntry, error });
      }
    }
  }

  return Array.from(totals.entries()).map(([receiverId, amount]) => ({ receiverId, amount }));
}

function formatYocto(amountBigInt, decimals = 8) {
  try {
    const value = BigInt(amountBigInt);
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = value / divisor;
    const fraction = value % divisor;

    if (fraction === 0n) {
      return whole.toString();
    }

    const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole.toString()}.${fractionStr}`;
  } catch (error) {
    console.warn('Failed to format yocto amount', { amountBigInt, error });
    return String(amountBigInt);
  }
}

function formatSuccessSummary(body, requestPayload) {
  const lines = [];
  lines.push(body.message || 'Transfer request accepted');

  if (typeof body.transfers === 'number') {
    lines.push(`Transfers: ${body.transfers}`);
  }

  if (Array.isArray(body.results) && body.results.length > 0) {
    lines.push('Transfers:');
    for (const result of body.results) {
      const receiver = result.receiverId || requestPayload?.receiverId;
      const amount = result.amount || requestPayload?.amount;
      const suffix = result.transactionHash ? ` → ${result.transactionHash}` : '';
      lines.push(`• ${receiver ?? 'unknown'} (${amount ?? 'n/a'})${suffix}`);
    }
  } else if (requestPayload?.receiverId) {
    const suffix = body.transactionHash ? ` → ${body.transactionHash}` : '';
    lines.push(`Receiver: ${requestPayload.receiverId}${suffix}`);
  }

  if (body.jobId) {
    lines.push(`Job ID: ${body.jobId}`);
  }

  if (body.transactionHash) {
    lines.push(`Transaction: ${body.transactionHash}`);
  }

  if (body.status) {
    lines.push(`Final status: ${body.status}`);
  }

  return lines.join('\n');
}

function deriveErrorMessage(body) {
  if (!body || typeof body !== 'object') {
    return 'Request failed';
  }

  if (typeof body.message === 'string' && body.message.length > 0) {
    return body.message;
  }

  const executionError = body.details?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  if (typeof executionError === 'string' && executionError.length > 0) {
    return executionError.replace('Smart contract panicked: ', '');
  }

  if (typeof body.error === 'string' && body.error.length > 0) {
    return body.error;
  }

  return 'Request failed';
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_FORM_STATE.apiBase;
  }

  try {
    const parsed = new URL(trimmed);
    const cleanedPath = parsed.pathname.endsWith('/') && parsed.pathname !== '/'
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    return cleanedPath && cleanedPath !== '/'
      ? `${parsed.origin}${cleanedPath}`
      : parsed.origin;
  } catch (error) {
    console.warn('Invalid base URL provided, falling back to default', error);
    return DEFAULT_FORM_STATE.apiBase;
  }
}

async function callSendFt(payload, baseUrl) {
  const endpoint = new URL('/send-ft', baseUrl);
  const res = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  appendLog(`POST ${endpoint.pathname} → ${res.status}`);

  const text = await res.text();
  try {
    return {
      ok: res.ok,
      status: res.status,
      body: JSON.parse(text),
    };
  } catch (error) {
    return {
      ok: res.ok,
      status: res.status,
      body: text,
    };
  }
}

async function callHealth(baseUrl) {
  const endpoint = new URL('/health', baseUrl);
  const res = await fetch(endpoint.toString());
  appendLog(`GET ${endpoint.pathname} → ${res.status}`);
  return res.json();
}

sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(sendForm);
  const baseUrl = normalizeBaseUrl(String(formData.get('apiBase') || ''));
  const receiverId = String(formData.get('receiverId') || '').trim();
  const amount = String(formData.get('amount') || '').trim();
  const memo = String(formData.get('memo') || '').trim();

  if (!baseUrl || !receiverId || !amount) {
    setResponse('Please provide API base URL, receiver ID, and amount.', { isError: true });
    return;
  }

  const payload = {
    receiverId,
    amount,
  };

  if (memo) {
    payload.memo = memo;
  }

  persistForm();

  submitBtn.disabled = true;
  setResponse('Sending transfer…');

  try {
    const result = await callSendFt(payload, baseUrl);
    const serialized = safeJsonStringify(result.body);

    if (result.ok && typeof result.body === 'object' && result.body !== null) {
      const summary = formatSuccessSummary(result.body, payload);
      setResponse(summary, { raw: serialized });
    } else if (result.ok) {
      setResponse('Transfer request accepted', { raw: serialized });
    } else {
      const message = deriveErrorMessage(result.body);
      setResponse(`Status ${result.status}\n${message}`, {
        isError: true,
        raw: serialized,
      });
      appendLog(message, 'error');
    }
  } catch (error) {
    console.error(error);
    setResponse(`Network error: ${error.message}`, {
      isError: true,
      raw: error?.stack || String(error),
    });
    appendLog(`Network error: ${error.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

healthBtn.addEventListener('click', async () => {
  persistForm();

  const baseUrl = normalizeBaseUrl(apiBaseInput.value);
  if (!baseUrl) {
    setResponse('Please provide the API base URL before checking health.', { isError: true });
    return;
  }

  healthBtn.disabled = true;
  setResponse('Checking health…');

  try {
    const body = await callHealth(baseUrl);
    const raw = safeJsonStringify(body);
    const summary = body.status ? `Health: ${body.status}` : 'Health check response received';
    setResponse(summary, { raw });
  } catch (error) {
    console.error(error);
    setResponse(`Health check failed: ${error.message}`, {
      isError: true,
      raw: error?.stack || String(error),
    });
    appendLog(`Health check failed: ${error.message}`, 'error');
  } finally {
    healthBtn.disabled = false;
  }
});

hydrateForm();
setResponse('Waiting for request…');

sendForm.addEventListener('input', persistForm);

document.querySelectorAll('[data-base-url]').forEach((button) => {
  button.addEventListener('click', () => {
    const presetUrl = button.dataset.baseUrl;
    if (!presetUrl) {
      return;
    }

    apiBaseInput.value = presetUrl;
    persistForm();
    const label = button.dataset.presetName || presetUrl;
    setResponse(`API base set to ${label}`);
    appendLog(`Preset applied: ${label}`);
  });
});
