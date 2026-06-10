import { EventStore } from "../../src/domain/events/event-store";
import { LedgerService } from "../../src/domain/ledger/ledger.service";
import { OrderService } from "../../src/domain/orders/order.service";
import { StripeMock } from "../../src/domain/payments/stripe.mock";
import { PaymentService } from "../../src/domain/payments/payment.service";
import { InvalidTransitionError } from "../../src/lib/errors";
import { toDecimal } from "../../src/lib/decimal";

function createMockDb() {
  const orders = new Map<string, any>();
  const events = new Map<string, any>();
  const eventsByAggregate = new Map<string, any[]>();
  const ledgerEntries: any[] = [];
  let idCounter = 0;

  const nextId = () => `id_${++idCounter}`;

  const txProxy = (db: any) =>
    new Proxy(db, {
      get: (target, prop) => target[prop],
    });

  const db: any = {
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(txProxy(db)),

    order: {
      create: async ({ data }: any) => {
        orders.set(data.id, {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return orders.get(data.id);
      },
      findUnique: async ({ where }: any) => orders.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const o = orders.get(where.id);
        if (!o) throw new Error(`Order ${where.id} not found`);
        return o;
      },
      findMany: async ({ where, skip = 0, take = 20 }: any) => {
        let result = [...orders.values()];
        if (where?.status?.in)
          result = result.filter((o) => where.status.in.includes(o.status));
        if (where?.status && typeof where.status === "string")
          result = result.filter((o) => o.status === where.status);
        return result.slice(skip, skip + take);
      },
      updateMany: async ({ where, data }: any) => {
        const order = orders.get(where.id);
        if (!order || order.version !== where.version) return { count: 0 };
        const updated = {
          ...order,
          ...data,
          version: data.version?.increment
            ? order.version + data.version.increment
            : data.version,
          updatedAt: new Date(),
        };
        orders.set(where.id, updated);
        return { count: 1 };
      },
      count: async () => orders.size,
    },

    eventLog: {
      create: async ({ data }: any) => {
        if (events.has(data.idempotencyKey)) {
          const err: any = new Error("Unique constraint violation");
          err.code = "P2002";
          throw err;
        }
        const event = { id: nextId(), timestamp: new Date(), ...data };
        events.set(data.idempotencyKey, event);
        const existing = eventsByAggregate.get(data.aggregateId) ?? [];
        if (existing.some((e) => e.version === data.version)) {
          const err: any = new Error("Unique constraint violation");
          err.code = "P2002";
          throw err;
        }
        eventsByAggregate.set(data.aggregateId, [...existing, event]);
        return event;
      },
      findUnique: async ({ where }: any) => {
        if (where.idempotencyKey)
          return events.get(where.idempotencyKey) ?? null;
        return null;
      },
      findFirst: async ({ where, orderBy }: any) => {
        const agg = eventsByAggregate.get(where.aggregateId) ?? [];
        if (agg.length === 0) return null;
        return agg.sort((a, b) => b.version - a.version)[0];
      },
      findMany: async ({ where, orderBy }: any) => {
        const agg = eventsByAggregate.get(where.aggregateId) ?? [];
        return agg.sort((a, b) => a.version - b.version);
      },
    },

    ledgerEntry: {
      create: async ({ data }: any) => {
        const entry = { id: nextId(), timestamp: new Date(), ...data };
        ledgerEntries.push(entry);
        return entry;
      },
      findMany: async ({ where }: any) => {
        let result = [...ledgerEntries];
        if (where?.orderId)
          result = result.filter((e) => e.orderId === where.orderId);
        if (where?.account?.in)
          result = result.filter((e) => where.account.in.includes(e.account));
        return result.sort((a, b) => a.timestamp - b.timestamp);
      },
    },

    _orders: orders,
    _events: events,
    _ledger: ledgerEntries,
  };

  return db;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Order + Payment Integration", () => {
  let db: any;
  let eventStore: EventStore;
  let ledger: LedgerService;
  let orderService: OrderService;
  let stripe: StripeMock;
  let paymentService: PaymentService;

  beforeEach(() => {
    db = createMockDb();
    eventStore = new EventStore(db);
    ledger = new LedgerService(db);
    orderService = new OrderService(db, eventStore, ledger);
    stripe = new StripeMock();
    paymentService = new PaymentService(db, stripe, orderService);
    process.env.STRIPE_MOCK_FAILURE_RATE = "0";
  });

  // ── Test 1: Happy Path ──────────────────────────────────────────────────

  it("happy path: create order → pay → verify ledger balanced", async () => {
    const orderId = "order-001";
    const amount = "100.0000";

    // 1. Buat order
    await orderService.recordOrder({
      orderId,
      customerId: "cust-1",
      amount,
      paymentMethod: "credit_card",
      idempotencyKey: "idem-create-001",
    });

    // 2. Proses payment
    await paymentService.processPayment({
      orderId,
      customerId: "cust-1",
      idempotencyKey: "idem-pay-001",
    });

    // 3. Verifikasi order status
    const order = await db.order.findUnique({ where: { id: orderId } });
    expect(order.status).toBe("FEE_CALCULATED");

    // 4. Verifikasi ledger balance: sum(debit) MUST = sum(credit)
    const { balanced } = await ledger.verifyBalance(orderId);
    expect(balanced).toBe(true);
  });

  // ── Test 2: Idempotency ────────────────────────────────────────────────

  it("idempotency: calling recordOrder twice with same key = one order", async () => {
    const params = {
      orderId: "order-002",
      customerId: "cust-2",
      amount: "50.0000",
      paymentMethod: "credit_card" as const,
      idempotencyKey: "idem-create-002",
    };

    await orderService.recordOrder(params);
    await orderService.recordOrder(params); // panggil kedua kali

    // Hanya satu order yang tercatat
    const orders = db._orders as Map<string, any>;
    const ordersForId = [...orders.values()].filter(
      (o) => o.id === "order-002",
    );
    expect(ordersForId).toHaveLength(1);
  });

  // ── Test 3: Ledger Balance ─────────────────────────────────────────────

  it("ledger: after full payment flow, debits = credits", async () => {
    const orderId = "order-003";
    await orderService.recordOrder({
      orderId,
      customerId: "cust-3",
      amount: "200.0000",
      paymentMethod: "credit_card",
      idempotencyKey: "idem-create-003",
    });

    await paymentService.processPayment({
      orderId,
      customerId: "cust-3",
      idempotencyKey: "idem-pay-003",
    });

    const entries = db._ledger.filter((e: any) => e.orderId === orderId);
    let totalDebit = toDecimal("0");
    let totalCredit = toDecimal("0");

    for (const entry of entries) {
      if (entry.debit)
        totalDebit = totalDebit.add(toDecimal(entry.debit.toString()));
      if (entry.credit)
        totalCredit = totalCredit.add(toDecimal(entry.credit.toString()));
    }

    expect(totalDebit.toFixed(4)).toBe(totalCredit.toFixed(4));
  });

  // ── Test 4: Decimal Precision ──────────────────────────────────────────

  it("decimal precision: fee for $999,999.99 is exact", async () => {
    const orderId = "order-004";
    await orderService.recordOrder({
      orderId,
      customerId: "cust-4",
      amount: "999999.9900",
      paymentMethod: "credit_card",
      idempotencyKey: "idem-create-004",
    });

    await paymentService.processPayment({
      orderId,
      customerId: "cust-4",
      idempotencyKey: "idem-pay-004",
    });

    // Fee harus 29999.9997, bukan hasil float yang salah
    const feeEntries = db._ledger.filter(
      (e: any) => e.orderId === orderId && e.account === "fees_owed",
    );
    expect(feeEntries).toHaveLength(1);
    expect(feeEntries[0].debit.toString()).toBe("29999.9997");
  });

  // ── Test 5: Concurrent Orders ──────────────────────────────────────────

  it("concurrent: 100 orders processed simultaneously, all recorded, no duplicates", async () => {
    const N = 100;
    const promises = Array.from({ length: N }, (_, i) =>
      orderService.recordOrder({
        orderId: `order-conc-${i}`,
        customerId: `cust-${i}`,
        amount: "10.0000",
        paymentMethod: "credit_card",
        idempotencyKey: `idem-conc-${i}`,
      }),
    );

    await Promise.all(promises);

    const orders = [...(db._orders as Map<string, any>).values()].filter((o) =>
      o.id.startsWith("order-conc-"),
    );
    expect(orders).toHaveLength(N);

    // Tidak ada duplicate ID
    const ids = orders.map((o) => o.id);
    expect(new Set(ids).size).toBe(N);
  }, 15000);

  // ── Test 6: Version Conflict ───────────────────────────────────────────

  it("version conflict: second payment with different key rejected after first succeeds", async () => {
    const orderId = "order-vc-001";
    await orderService.recordOrder({
      orderId,
      customerId: "cust-vc",
      amount: "100.0000",
      paymentMethod: "credit_card",
      idempotencyKey: "idem-vc-create",
    });

    // Request pertama sukses — proses full payment
    await paymentService.processPayment({
      orderId,
      customerId: "cust-vc",
      idempotencyKey: "idem-vc-pay-A",
    });

    const order = await orderService.findById(orderId);
    expect(order.status).toBe("FEE_CALCULATED");

    // Request kedua dengan key BERBEDA harus ditolak
    // karena order sudah FEE_CALCULATED, tidak bisa bayar lagi
    await expect(
      orderService.recordPayment({
        orderId,
        amount: "100.0000",
        chargeId: "ch_duplicate",
        idempotencyKey: "idem-vc-pay-B", // key berbeda = bukan idempotent retry
      }),
    ).rejects.toThrow(Error);

    // Verifikasi hanya ada satu PaymentConfirmed event
    const paymentEvents = [...(db._events as Map<string, any>).values()].filter(
      (e) => e.eventType === "PaymentConfirmed" && e.aggregateId === orderId,
    );
    expect(paymentEvents).toHaveLength(1);
  });

  // ── Test 7: Invalid Transition ─────────────────────────────────────────

  it("invalid transition: cannot pay a SHIPPED order", async () => {
    const orderId = "order-it-001";
    await orderService.recordOrder({
      orderId,
      customerId: "cust-it",
      amount: "100.0000",
      paymentMethod: "credit_card",
      idempotencyKey: "idem-it-create",
    });

    // Paksa status jadi SHIPPED langsung (bypass state machine — simulate corrupt data)
    db._orders.set(orderId, {
      ...db._orders.get(orderId),
      status: "SHIPPED",
    });

    await expect(
      orderService.recordPayment({
        orderId,
        amount: "100.0000",
        chargeId: "ch_it_001",
        idempotencyKey: "idem-it-pay",
      }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  // ── Test 8: Settlement Idempotency ─────────────────────────────────────

  it("settlement idempotency: settling same date twice returns same result", async () => {
    const { SettlementService } =
      await import("../../src/domain/settlement/settlement.service");
    const settlementService = new SettlementService(db, eventStore, ledger);

    // Buat satu order dan proses payment dulu supaya ada data untuk di-settle
    const orderId = "order-settle-idem";
    await orderService.recordOrder({
      orderId,
      customerId: "cust-settle",
      amount: "100.0000",
      paymentMethod: "credit_card",
      idempotencyKey: "idem-settle-create",
    });
    await paymentService.processPayment({
      orderId,
      customerId: "cust-settle",
      idempotencyKey: "idem-settle-pay",
    });

    // Settle pertama kali
    const result1 = await settlementService.settle("2026-01-15");
    expect(result1.idempotent).toBe(false);

    // Settle kedua kali — harus return idempotent = true
    const result2 = await settlementService.settle("2026-01-15");
    expect(result2.idempotent).toBe(true);

    // Hasil identik
    expect(result1.date).toBe(result2.date);
    expect(result1.totalPayout).toBe(result2.totalPayout);

    // Hanya satu event settlement di DB
    const settlementEvents = [
      ...(db._events as Map<string, any>).values(),
    ].filter((e) => e.idempotencyKey === "settlement-2026-01-15");
    expect(settlementEvents).toHaveLength(1);
  });

  // ── Test 9: Projection Consistency ────────────────────────────────────

  it("projection consistency: order summary matches ledger entries", async () => {
    const { ReadModelProjection } =
      await import("../../src/projections/read-model");
    const readModel = new ReadModelProjection(db);

    const orderId = "order-proj-001";
    const amount = "150.0000";

    await orderService.recordOrder({
      orderId,
      customerId: "cust-proj",
      amount,
      paymentMethod: "credit_card",
      idempotencyKey: "idem-proj-create",
    });

    await paymentService.processPayment({
      orderId,
      customerId: "cust-proj",
      idempotencyKey: "idem-proj-pay",
    });

    const summary = await readModel.getOrderSummary(orderId);
    expect(summary).not.toBeNull();

    // Fee = 3% dari amount
    expect(summary!.fee).toBe("4.5000"); // 150 * 0.03 = 4.5000
    // Payout = amount - fee
    expect(summary!.payout).toBe("145.5000"); // 150 - 4.5 = 145.5000
    // Status sudah FEE_CALCULATED
    expect(summary!.status).toBe("FEE_CALCULATED");
  });
});
