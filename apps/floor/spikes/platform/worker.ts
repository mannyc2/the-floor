import type { ExportedHandler } from "@cloudflare/workers-types";
import { Cause, Effect, Exit } from "effect";
import { AgentProbe, readAgentProbe, submitAgentProbe } from "./agent";
import bareWorker from "./bare-worker";
import type { ProbeEnvironment } from "./bare-worker";
import { probeLaunchConstruction } from "./launch";

export { AlarmProbe, JournalProbe } from "./bare-worker";
export { AgentProbe };

interface AgentEnvironment extends ProbeEnvironment {
  readonly AGENT: DurableObjectNamespace<AgentProbe>;
}

const response = <A, E>(exit: Exit.Exit<A, E>): Response =>
  Exit.isSuccess(exit)
    ? Response.json({ ok: true, result: exit.value })
    : Response.json({ ok: false, cause: Cause.pretty(exit.cause) }, { status: 500 });

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    const threadName = url.searchParams.get("thread") ?? "local-agent-alarm-001";
    if (url.pathname === "/agent/submit" && request.method === "POST") {
      const key = url.searchParams.get("key") ?? "local-submission-001";
      return Effect.runPromiseExit(submitAgentProbe(env.AGENT, threadName, key)).then(response);
    }
    if (url.pathname === "/agent/read") {
      return Effect.runPromiseExit(readAgentProbe(env.AGENT, threadName)).then(response);
    }
    if (url.pathname === "/agent/snapshot") {
      return env.AGENT.get(env.AGENT.idFromName(threadName)).probeSnapshot().then((snapshot) =>
        Response.json(snapshot)
      );
    }
    if (url.pathname === "/launch") {
      return Effect.runPromiseExit(probeLaunchConstruction).then(response);
    }
    return bareWorker.fetch(request, env);
  },
} satisfies ExportedHandler<AgentEnvironment>;
