export async function jsonRequest(
  url,
  { method = "GET", body, headers = {}, timeout = 20000 } = {}
) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { description: text.slice(0, 160) };
  }
  if (!response.ok) {
    const error = Error(
      `HTTP ${response.status}: ${
        data.errorType ??
        data.description ??
        data.status?.error_message ??
        data.error ??
        "Request failed"
      }`
    );
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after") || 60);
    throw error;
  }
  return data;
}
