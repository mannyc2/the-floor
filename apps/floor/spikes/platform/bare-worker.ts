import type {
  D1Database,
  DurableObjectNamespace,
  DurableObjectState,
  ExportedHandler,
} from "@cloudflare/workers-types";
import { Cause, Clock, Effect, Exit, ManagedRuntime, Option } from "effect";
import { probeCrypto } from "./crypto";
import { ProbeError } from "./errors";
import { History, Journal } from "./storage";

export interface ProbeEnvironment {
  readonly HISTORY: D1Database;
  readonly JOURNAL: DurableObjectNamespace;
  readonly ALARMS: DurableObjectNamespace;
}

const response = <A, E>(exit: Exit.Exit<A, E>): Response =>
  Exit.isSuccess(exit)
    ? Response.json({ ok: true, result: exit.value })
    : Response.json({ ok: false, cause: Cause.pretty(exit.cause) }, { status: 500 });

const native = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new ProbeError({ operation, cause }) });

export class JournalProbe {
  private readonly runtime;

  constructor(state: DurableObjectState) {
    this.runtime = ManagedRuntime.make(Journal.layer(state.storage));
  }

  fetch(request: Request): Promise<Response> | Response {
    const path = new URL(request.url).pathname;
    switch (path) {
      case "/journal/rollback":
        return this.runtime.runPromiseExit(Journal.use((service) => service.rollback)).then(response);
      case "/journal/nested":
        return this.runtime.runPromiseExit(Journal.use((service) => service.nested)).then(response);
      case "/journal/reserve":
        return this.runtime.runPromiseExit(Journal.use((service) => service.reserve)).then(response);
      case "/journal/read":
        return this.runtime.runPromiseExit(Journal.use((service) => service.read)).then(response);
      case "/journal/dispose":
        return this.runtime.dispose().then(() => Response.json({ disposed: true }));
      default:
        return new Response("Unknown journal probe", { status: 404 });
    }
  }
}

// A native alarm isolates the scheduler prerequisite from the separate
// Yielded agent loop. Reads do not increment or schedule the wake counter.
export class AlarmProbe {
  constructor(private readonly state: DurableObjectState) {}

  fetch(request: Request): Promise<Response> {
    const storage = this.state.storage;
    const schedule = Effect.gen(function*() {
      const now = yield* Clock.currentTimeMillis;
      yield* native("alarm.mark", () => storage.put("scheduled", true));
      yield* native("alarm.schedule", () => storage.setAlarm(now + 750));
      return { scheduled: true };
    });
    const read = Effect.gen(function*() {
      const scheduled = yield* native("alarm.readScheduled", () => storage.get<boolean>("scheduled"));
      const count = yield* native("alarm.readCount", () => storage.get<number>("wakeCount"));
      const alarm = yield* native("alarm.readPending", () => storage.getAlarm());
      return {
        scheduled: Option.getOrElse(Option.fromUndefinedOr(scheduled), () => false),
        wakeCount: Option.getOrElse(Option.fromUndefinedOr(count), () => 0),
        alarmPending: Option.isSome(Option.fromNullOr(alarm)),
      };
    });
    return Effect.runPromiseExit(
      new URL(request.url).pathname === "/alarm/schedule" ? schedule : read,
    ).then(response);
  }

  alarm(): Promise<void> {
    return this.state.storage.transaction((transaction) =>
      Effect.runPromise(Effect.gen(function*() {
        const value = yield* native("alarm.count", () => transaction.get<number>("wakeCount"));
        const count = Option.getOrElse(Option.fromUndefinedOr(value), () => 0);
        yield* native("alarm.increment", () => transaction.put("wakeCount", count + 1));
      }))
    );
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/journal/")) {
      return env.JOURNAL.get(env.JOURNAL.idFromName("local-journal-probe")).fetch(request);
    }
    if (url.pathname.startsWith("/alarm/")) {
      return env.ALARMS.get(env.ALARMS.idFromName("local-alarm-probe")).fetch(request);
    }
    if (url.pathname === "/crypto") {
      return Effect.runPromiseExit(probeCrypto).then(response);
    }
    const layer = History.layer(env.HISTORY);
    switch (url.pathname) {
      case "/d1/initialize":
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Worker request entrypoint; the D1 layer closes with the response.
        return Effect.runPromiseExit(History.use((service) => service.initialize).pipe(Effect.provide(layer))).then(
          response,
        );
      case "/d1/read":
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Worker request entrypoint; the D1 layer closes with the response.
        return Effect.runPromiseExit(History.use((service) => service.read).pipe(Effect.provide(layer))).then(response);
      case "/d1/batch":
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Worker request entrypoint; the D1 layer closes with the response.
        return Effect.runPromiseExit(History.use((service) => service.batch).pipe(Effect.provide(layer))).then(
          response,
        );
      case "/d1/migrate":
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Worker request entrypoint; the D1 layer closes with the response.
        return Effect.runPromiseExit(History.use((service) => service.migrate).pipe(Effect.provide(layer))).then(
          response,
        );
      default:
        return new Response("Unknown platform probe", { status: 404 });
    }
  },
} satisfies ExportedHandler<ProbeEnvironment>;
