const sendForm = document.querySelector('#send-form');
const responseEl = document.querySelector('#response');
const logEl = document.querySelector('#log');
const submitBtn = document.querySelector('#submit-btn');
const healthBtn = document.querySelector('#health-btn');

function appendLog(message, status = 'info') {
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString();
  time.dateTime = new Date().toISOString();

  const detail = document.createElement('span');
  detail.textContent = message;
  detail.className = status;

  li.appendChild(time);
  li.appendChild(detail);
  logEl.prepend(li);
}

function setResponse(content, isError = false) {
  responseEl.textContent = content;
  responseEl.dataset.state = isError ? 'error' : 'ok';
}

async function callSendFt(payload, baseUrl) {
  const endpoint = new URL('/send-ft', baseUrl);
  const res = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  appendLog(`POST ${endpoint.pathname} → ${res.status}`);

  const text = await res.text();
  try {
    return {
      ok: res.ok,
      status: res.status,
      body: JSON.parse(text)
    };
  } catch (err) {
    return {
      ok: res.ok,
      status: res.status,
      body: text
    };
  }
}

async function callHealth(baseUrl) {
  const endpoint = new URL('/health', baseUrl);
  const res = await fetch(endpoint.toString());
  appendLog(`GET ${endpoint.pathname} → ${res.status}`);
  const body = await res.json();
  return body;
}

sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(sendForm);
  const baseUrl = formData.get('apiBase');
  const receiverId = formData.get('receiverId');
  const amount = formData.get('amount');
  const memo = formData.get('memo');

  if (!baseUrl || !receiverId || !amount) {
    setResponse('Please provide API base URL, receiver ID, and amount.', true);
    return;
  }

  const payload = {
    receiverId,
    amount: amount.toString()
  };

  if (memo) {
    payload.memo = memo;
  }

  submitBtn.disabled = true;
  setResponse('Sending transfer…');

  try {
    const result = await callSendFt(payload, baseUrl);
    const serialized = JSON.stringify(result.body, null, 2);
    if (result.ok) {
      setResponse(serialized);
    } else {
      setResponse(`Status ${result.status}\n${serialized}`, true);
    }
  } catch (error) {
    console.error(error);
    setResponse(`Network error: ${error.message}`, true);
    appendLog(`Network error: ${error.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

healthBtn.addEventListener('click', async () => {
  const baseUrl = document.querySelector('#apiBase').value;
  if (!baseUrl) {
    setResponse('Please provide the API base URL before checking health.', true);
    return;
  }

  healthBtn.disabled = true;
  setResponse('Checking health…');

  try {
    const body = await callHealth(baseUrl);
    setResponse(JSON.stringify(body, null, 2));
  } catch (error) {
    console.error(error);
    setResponse(`Health check failed: ${error.message}`, true);
    appendLog(`Health check failed: ${error.message}`, 'error');
  } finally {
    healthBtn.disabled = false;
  }
});
