import { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";

const prisma = new PrismaClient();

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function randomAmount(): string {
  const amounts = [
    "25.0000",
    "50.0000",
    "75.0000",
    "100.0000",
    "150.0000",
    "200.0000",
    "250.0000",
    "500.0000",
    "999.9900",
    "1250.0000",
    "49.9900",
    "99.9900",
    "199.9900",
    "299.9900",
    "750.0000",
  ];
  return amounts[Math.floor(Math.random() * amounts.length)]!;
}

function randomCustomer(): string {
  const customers = [
    "cust_budi_santoso",
    "cust_siti_rahayu",
    "cust_ahmad_fauzi",
    "cust_dewi_lestari",
    "cust_eko_prasetyo",
    "cust_fitri_handayani",
    "cust_galih_wibowo",
    "cust_hana_pertiwi",
    "cust_irfan_maulana",
    "cust_joko_susanto",
  ];
  return customers[Math.floor(Math.random() * customers.length)]!;
}

function randomPaymentMethod(): string {
  const methods = ["credit_card", "debit_card", "bank_transfer"];
  return methods[Math.floor(Math.random() * methods.length)]!;
}

function calculateFee(amount: string): string {
  return new Decimal(amount).mul("0.03").toDecimalPlaces(4).toFixed(4);
}

function calculatePayout(amount: string): string {
  const fee = new Decimal(amount).mul("0.03").toDecimalPlaces(4);
  return new Decimal(amount).sub(fee).toFixed(4);
}

// ── Seed functions ─────────────────────────────────────────────────────────

async function createOrderWithStatus(params: {
  status:
    | "PENDING"
    | "PAYMENT_CONFIRMED"
    | "FEE_CALCULATED"
    | "SHIPPED"
    | "DELIVERED"
    | "FAILED";
  daysAgo: number;
}) {
  const { status, daysAgo } = params;
  const orderId = `ord_${generateId()}`;
  const amount = randomAmount();
  const customerId = randomCustomer();
  const paymentMethod = randomPaymentMethod();
  const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  // Tentukan version berdasarkan status
  const versionMap = {
    PENDING: 0,
    PAYMENT_CONFIRMED: 2,
    FEE_CALCULATED: 3,
    SHIPPED: 4,
    DELIVERED: 5,
    FAILED: 1,
  };
  const version = versionMap[status];

  // Buat order
  await prisma.order.create({
    data: {
      id: orderId,
      customerId,
      amount,
      paymentMethod,
      status,
      version,
      createdAt,
      updatedAt: createdAt,
    },
  });

  // Event: OrderCreated
  await prisma.eventLog.create({
    data: {
      aggregateId: orderId,
      eventType: "OrderCreated",
      payload: { type: "OrderCreated", amount, customerId, paymentMethod },
      version: 1,
      idempotencyKey: `seed-create-${orderId}`,
      timestamp: createdAt,
    },
  });

  // Ledger: OrderCreated
  await prisma.ledgerEntry.createMany({
    data: [
      {
        orderId,
        account: "order_balance",
        debit: amount,
        credit: null,
        description: "Order created",
        timestamp: createdAt,
      },
      {
        orderId,
        account: "order_pending",
        debit: null,
        credit: amount,
        description: "Order created",
        timestamp: createdAt,
      },
    ],
  });

  if (status === "FAILED") return orderId;

  if (
    ["PAYMENT_CONFIRMED", "FEE_CALCULATED", "SHIPPED", "DELIVERED"].includes(
      status,
    )
  ) {
    const chargeId = `ch_mock_${generateId()}`;
    const payAt = new Date(createdAt.getTime() + 2 * 60 * 1000); // 2 menit setelah order

    // Event: PaymentConfirmed
    await prisma.eventLog.create({
      data: {
        aggregateId: orderId,
        eventType: "PaymentConfirmed",
        payload: { type: "PaymentConfirmed", chargeId, amount },
        version: 2,
        idempotencyKey: `seed-pay-${orderId}`,
        timestamp: payAt,
      },
    });

    // Ledger: PaymentConfirmed
    await prisma.ledgerEntry.createMany({
      data: [
        {
          orderId,
          account: "payment_received",
          debit: amount,
          credit: null,
          description: `Payment confirmed - charge ${chargeId}`,
          timestamp: payAt,
        },
        {
          orderId,
          account: "order_balance",
          debit: null,
          credit: amount,
          description: `Payment confirmed - charge ${chargeId}`,
          timestamp: payAt,
        },
      ],
    });
  }

  if (["FEE_CALCULATED", "SHIPPED", "DELIVERED"].includes(status)) {
    const fee = calculateFee(amount);
    const feeAt = new Date(createdAt.getTime() + 3 * 60 * 1000); // 3 menit setelah order

    // Event: FeeCalculated
    await prisma.eventLog.create({
      data: {
        aggregateId: orderId,
        eventType: "FeeCalculated",
        payload: { type: "FeeCalculated", fee, rate: "0.03" },
        version: 3,
        idempotencyKey: `seed-fee-${orderId}`,
        timestamp: feeAt,
      },
    });

    // Ledger: FeeCalculated
    await prisma.ledgerEntry.createMany({
      data: [
        {
          orderId,
          account: "fees_owed",
          debit: fee,
          credit: null,
          description: `Fee 3% of ${amount}`,
          timestamp: feeAt,
        },
        {
          orderId,
          account: "payment_received",
          debit: null,
          credit: fee,
          description: `Fee 3% of ${amount}`,
          timestamp: feeAt,
        },
      ],
    });
  }

  if (["SHIPPED", "DELIVERED"].includes(status)) {
    const shipAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

    await prisma.eventLog.create({
      data: {
        aggregateId: orderId,
        eventType: "OrderShipped",
        payload: {
          type: "OrderShipped",
          trackingNumber: `TRK${generateId().toUpperCase()}`,
        },
        version: 4,
        idempotencyKey: `seed-ship-${orderId}`,
        timestamp: shipAt,
      },
    });
  }

  if (status === "DELIVERED") {
    const deliverAt = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 hari setelah

    await prisma.eventLog.create({
      data: {
        aggregateId: orderId,
        eventType: "OrderDelivered",
        payload: { type: "OrderDelivered" },
        version: 5,
        idempotencyKey: `seed-deliver-${orderId}`,
        timestamp: deliverAt,
      },
    });

    // Ledger: Settlement payout untuk delivered orders
    const payout = calculatePayout(amount);
    const settleAt = new Date(createdAt.getTime() + 4 * 24 * 60 * 60 * 1000);
    await prisma.ledgerEntry.createMany({
      data: [
        {
          orderId,
          account: "seller_payout",
          debit: payout,
          credit: null,
          description: `Daily settlement`,
          timestamp: settleAt,
        },
        {
          orderId,
          account: "payment_received",
          debit: null,
          credit: payout,
          description: `Daily settlement`,
          timestamp: settleAt,
        },
      ],
    });
  }

  return orderId;
}

// ── Main seed ──────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding database...");

  // Clear existing data
  await prisma.ledgerEntry.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.order.deleteMany();
  console.log("Cleared existing data");

  // Buat orders dengan berbagai status dan tanggal
  const orderSpecs: Array<{
    status:
      | "PENDING"
      | "PAYMENT_CONFIRMED"
      | "FEE_CALCULATED"
      | "SHIPPED"
      | "DELIVERED"
      | "FAILED";
    daysAgo: number;
    count: number;
  }> = [
    { status: "PENDING", daysAgo: 0, count: 3 },
    { status: "PAYMENT_CONFIRMED", daysAgo: 1, count: 3 },
    { status: "FEE_CALCULATED", daysAgo: 1, count: 4 },
    { status: "FEE_CALCULATED", daysAgo: 2, count: 3 },
    { status: "SHIPPED", daysAgo: 2, count: 3 },
    { status: "DELIVERED", daysAgo: 5, count: 3 },
    { status: "DELIVERED", daysAgo: 7, count: 3 },
    { status: "FAILED", daysAgo: 1, count: 2 },
  ];

  let totalCreated = 0;
  for (const spec of orderSpecs) {
    for (let i = 0; i < spec.count; i++) {
      await createOrderWithStatus({
        status: spec.status,
        daysAgo: spec.daysAgo,
      });
      totalCreated++;
    }
  }
  console.log(`Created ${totalCreated} orders`);

  // Buat settlement event untuk hari ini
  const today = new Date().toISOString().split("T")[0]!;
  const deliveredOrders = await prisma.order.findMany({
    where: { status: "DELIVERED" },
    select: { id: true, amount: true },
  });

  if (deliveredOrders.length > 0) {
    let totalRevenue = new Decimal(0);
    let totalFees = new Decimal(0);
    let totalPayout = new Decimal(0);

    for (const order of deliveredOrders) {
      const amount = new Decimal(order.amount.toString());
      const fee = amount.mul("0.03").toDecimalPlaces(4);
      totalRevenue = totalRevenue.add(amount);
      totalFees = totalFees.add(fee);
      totalPayout = totalPayout.add(amount.sub(fee));
    }

    await prisma.eventLog.create({
      data: {
        aggregateId: `settlement-${today}`,
        eventType: "SettlementProcessed",
        payload: {
          type: "SettlementProcessed",
          date: today,
          totalOrders: String(deliveredOrders.length),
          totalRevenue: totalRevenue.toFixed(4),
          totalFees: totalFees.toFixed(4),
          totalPayout: totalPayout.toFixed(4),
        },
        version: 1,
        idempotencyKey: `settlement-${today}`,
      },
    });
    console.log(`Created settlement for ${today}`);
    console.log(`Orders: ${deliveredOrders.length}`);
    console.log(`Revenue: $${totalRevenue.toFixed(2)}`);
    console.log(`Fees: $${totalFees.toFixed(2)}`);
    console.log(`Payout: $${totalPayout.toFixed(2)}`);
  }

  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
