#!/usr/bin/env node

const EXIT_CONFIGURATION = 2;
const EXIT_DENIED = 3;

function deny(message, details = {}) {
  console.error(JSON.stringify({ installAllowed: false, error: message, ...details }, null, 2));
  process.exitCode = EXIT_CONFIGURATION;
}

function sourceFromArguments(args) {
  const [sourceUrl, skillPath] = args;
  if (!sourceUrl || args.length > 2) {
    throw new Error("Usage: check-skill.mjs <public-github-url> [skill-path]");
  }

  const parsed = new URL(sourceUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || segments.length < 2) {
    throw new Error("Source must be a public https://github.com/<owner>/<repo> URL");
  }
  if (skillPath && (skillPath.startsWith("/") || skillPath.split("/").includes(".."))) {
    throw new Error("Skill path must be a safe repository-relative path");
  }

  return { url: parsed.toString(), ...(skillPath ? { path: skillPath } : {}) };
}

function apiEndpoint() {
  const configured = process.env.AGENT_QUARANTINE_API_URL?.trim();
  if (!configured) throw new Error("AGENT_QUARANTINE_API_URL is required");

  const parsed = new URL(configured);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("AGENT_QUARANTINE_API_URL must use http or https");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/api/v1/skill-checks`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function timeoutMilliseconds() {
  const value = Number(process.env.AGENT_QUARANTINE_TIMEOUT_MS || 300000);
  if (!Number.isInteger(value) || value < 1000 || value > 600000) {
    throw new Error("AGENT_QUARANTINE_TIMEOUT_MS must be between 1000 and 600000");
  }
  return value;
}

function resultSummary(result) {
  const report = result?.report;
  return {
    jobId: result?.jobId,
    checkStatus: result?.checkStatus,
    cached: result?.cached,
    checkId: result?.checkId,
    decision: result?.decision,
    installAllowed: result?.installAllowed,
    reason: result?.reason,
    report: report && typeof report === "object" ? {
      id: report.id,
      scanRunId: report.scanRunId,
      mode: report.mode,
      repository: report.repository,
      gitHash: report.gitHash,
      targetPath: report.targetPath,
      status: report.status,
      riskScore: report.riskScore,
      verdict: report.verdict,
      generatedAt: report.generatedAt,
      findings: Array.isArray(report.findings) ? report.findings.map((finding) => ({
        title: finding.title,
        severity: finding.severity,
        summary: finding.summary,
      })) : undefined,
    } : undefined,
  };
}

async function fetchJson(url, options, signal) {
  const response = await fetch(url, { ...options, signal });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`API returned non-JSON content (HTTP ${response.status})`);
  }
  return { response, result };
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function main() {
  let source;
  let endpoint;
  let timeoutMs;
  try {
    source = sourceFromArguments(process.argv.slice(2));
    endpoint = apiEndpoint();
    timeoutMs = timeoutMilliseconds();
  } catch (error) {
    deny(error instanceof Error ? error.message : "Invalid configuration");
    return;
  }

  const apiKey = process.env.AGENT_QUARANTINE_API_KEY?.trim();
  if (!apiKey) {
    deny("AGENT_QUARANTINE_API_KEY is required");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let result;
  try {
    ({ response, result } = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source,
        client: {
          name: process.env.AGENT_QUARANTINE_CLIENT?.trim() || "agent-skill",
          ...(process.env.AGENT_QUARANTINE_SESSION_ID?.trim()
            ? { sessionId: process.env.AGENT_QUARANTINE_SESSION_ID.trim() }
            : {}),
        },
      }),
    }, controller.signal));

    while (response.status === 202) {
      if (typeof result?.pollUrl !== "string" || !result.pollUrl) {
        throw new Error("API accepted the check without a pollUrl");
      }
      const pollEndpoint = new URL(result.pollUrl, endpoint);
      if (pollEndpoint.origin !== new URL(endpoint).origin) {
        throw new Error("API returned a cross-origin pollUrl");
      }
      const retryAfter = Number(result.retryAfterSeconds ?? response.headers.get("retry-after") ?? 2);
      const delayMs = Number.isFinite(retryAfter)
        ? Math.min(Math.max(retryAfter * 1000, 0), 30_000)
        : 2_000;
      await wait(delayMs, controller.signal);
      ({ response, result } = await fetchJson(pollEndpoint, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
      }, controller.signal));
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `API request timed out after ${timeoutMs} ms`
      : error instanceof Error ? error.message : "API request failed";
    deny(message);
    return;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    deny(typeof result?.error === "string" ? result.error : `API request failed (HTTP ${response.status})`, {
      status: response.status,
    });
    return;
  }

  if (result?.checkStatus === "failed") {
    deny(typeof result.error === "string" ? result.error : "Sandbox check failed");
    return;
  }

  if (!["allow", "review", "block"].includes(result?.decision) || typeof result?.installAllowed !== "boolean") {
    deny("API response did not contain a valid install decision");
    return;
  }

  const summary = resultSummary(result);
  console.log(JSON.stringify(summary, null, 2));
  if (result.decision !== "allow" || result.installAllowed !== true) {
    process.exitCode = EXIT_DENIED;
  }
}

await main();
