import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL(
  "../skills/agent-quarantine-preinstall/scripts/check-skill.mjs",
  import.meta.url,
));
const source = "https://github.com/example/skill/tree/main/skills/demo";

function runGate(apiUrl, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, source], {
      env: {
        ...process.env,
        AGENT_QUARANTINE_API_URL: apiUrl,
        AGENT_QUARANTINE_API_KEY: "aq_test_key",
        AGENT_QUARANTINE_CLIENT: "codex",
        AGENT_QUARANTINE_SESSION_ID: "session-test",
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withApi(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function jsonResponse(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

test("allows only an explicit allow response and sends audit metadata", async () => {
  let received;
  const result = await withApi(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received = { url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) };
    jsonResponse(response, 201, {
      checkId: "skill-allow",
      decision: "allow",
      installAllowed: true,
      reason: "No blocking behavior observed",
      report: { id: "report-1", scanRunId: "run-1", riskScore: 4, status: "complete", findings: [] },
    });
  }, (apiUrl) => runGate(apiUrl));

  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).installAllowed, true);
  assert.equal(received.url, "/api/v1/skill-checks");
  assert.equal(received.authorization, "Bearer aq_test_key");
  assert.deepEqual(received.body.client, { name: "codex", sessionId: "session-test" });
  assert.equal(received.body.source.url, source);
});

test("denies review decisions with exit code 3", async () => {
  const result = await withApi((_request, response) => jsonResponse(response, 201, {
    checkId: "skill-review",
    decision: "review",
    installAllowed: false,
    reason: "Human review required",
    report: { scanRunId: "run-2", riskScore: 55, findings: [] },
  }), (apiUrl) => runGate(apiUrl));

  assert.equal(result.code, 3);
  assert.equal(JSON.parse(result.stdout).decision, "review");
});

test("fails closed on authentication or quota errors", async () => {
  const result = await withApi((_request, response) => jsonResponse(response, 401, {
    error: "Invalid or missing API key",
  }), (apiUrl) => runGate(apiUrl));

  assert.equal(result.code, 2);
  assert.match(result.stderr, /Invalid or missing API key/);
  assert.doesNotMatch(result.stderr, /aq_test_key/);
});

test("fails closed on malformed success responses", async () => {
  const result = await withApi((_request, response) => jsonResponse(response, 201, {
    decision: "allow",
  }), (apiUrl) => runGate(apiUrl));

  assert.equal(result.code, 2);
  assert.match(result.stderr, /valid install decision/);
});

test("requires an API URL before making a request", async () => {
  const result = await runGate("", { AGENT_QUARANTINE_API_URL: "" });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /AGENT_QUARANTINE_API_URL is required/);
});
