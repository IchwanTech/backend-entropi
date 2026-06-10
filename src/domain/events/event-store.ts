import {
  EventLog,
  TransactionClient,
  PrismaKnownError,
  EventType,
} from "../../db/types";
import { VersionConflictError } from "../../lib/errors";
import { EventPayload } from "./event-types";

export class EventStore {
  constructor(private readonly db: any) {}

  async append(
    tx: TransactionClient,
    params: {
      aggregateId: string;
      eventType: EventType;
      payload: EventPayload;
      idempotencyKey: string;
      expectedVersion: number;
    },
  ): Promise<EventLog> {
    const { aggregateId, eventType, payload, idempotencyKey, expectedVersion } =
      params;

    const existing = await tx.eventLog.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;

    try {
      return await tx.eventLog.create({
        data: {
          aggregateId,
          eventType,
          payload,
          version: expectedVersion + 1,
          idempotencyKey,
        },
      });
    } catch (err: unknown) {
      if (err instanceof PrismaKnownError && err.code === "P2002") {
        throw new VersionConflictError(aggregateId);
      }
      // Handle Prisma real errors too
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as any).code === "P2002"
      ) {
        throw new VersionConflictError(aggregateId);
      }
      throw err;
    }
  }

  async getEvents(aggregateId: string): Promise<EventLog[]> {
    return this.db.eventLog.findMany({
      where: { aggregateId },
      orderBy: { version: "asc" },
    });
  }

  async getCurrentVersion(
    tx: TransactionClient,
    aggregateId: string,
  ): Promise<number> {
    const latest = await tx.eventLog.findFirst({
      where: { aggregateId },
      orderBy: { version: "desc" },
    });
    return latest?.version ?? -1;
  }
}
