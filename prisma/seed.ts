/**
 * Seed script — generate data dummy untuk demo dashboard.
 * Jalankan: npx tsx prisma/seed.ts
 */

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

function calcFee(amount: string): string {
  return new Decimal(amount).mul("0.03").toDecimalPlaces(4).toFixed(4);
}

function calcPayout(amount: string): string {
  const fee = new Decimal(amount).mul("0.03").toDecimalPlaces(4);
  return new Decimal(amount).sub(fee).toFixed(4);
}

async function createOrder(params: {
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

  const versionMap = {
    PENDING: 0,
    PAYMENT_CONFIRMED: 2,
    FEE_CALCULATED: 3,
    SHIPPED: 4,
    DELIVERED: 5,
    FAILED: 1,
  };

  // 1. Buat Order
  await prisma.order.create({
    data: {
      id: orderId,
      customerId,
      amount,
      paymentMethod,
      status,
      version: versionMap[status],
      createdAt,
      updatedAt: createdAt,
    },
  });

  // 2. Event: OrderCreated — aggregateId = orderId (valid FK)
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

  // 3. Ledger: OrderCreated
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

  // Payment flow
  if (
    ["PAYMENT_CONFIRMED", "FEE_CALCULATED", "SHIPPED", "DELIVERED"].includes(
      status,
    )
  ) {
    const chargeId = `ch_mock_${generateId()}`;
    const payAt = new Date(createdAt.getTime() + 2 * 60 * 1000);

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

    await prisma.ledgerEntry.createMany({
      data: [
        {
          orderId,
          account: "payment_received",
          debit: amount,
          credit: null,
          description: `Payment confirmed - ${chargeId}`,
          timestamp: payAt,
        },
        {
          orderId,
          account: "order_balance",
          debit: null,
          credit: amount,
          description: `Payment confirmed - ${chargeId}`,
          timestamp: payAt,
        },
      ],
    });
  }

  // Fee flow
  if (["FEE_CALCULATED", "SHIPPED", "DELIVERED"].includes(status)) {
    const fee = calcFee(amount);
    const feeAt = new Date(createdAt.getTime() + 3 * 60 * 1000);

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

  // Shipped
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

  // Delivered + payout
  if (status === "DELIVERED") {
    const deliverAt = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    const settleAt = new Date(createdAt.getTime() + 4 * 24 * 60 * 60 * 1000);
    const payout = calcPayout(amount);

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

    await prisma.ledgerEntry.createMany({
      data: [
        {
          orderId,
          account: "seller_payout",
          debit: payout,
          credit: null,
          description: "Daily settlement",
          timestamp: settleAt,
        },
        {
          orderId,
          account: "payment_received",
          debit: null,
          credit: payout,
          description: "Daily settlement",
          timestamp: settleAt,
        },
      ],
    });
  }

  return orderId;
}

async function main() {
  console.log("Seeding database...");

  await prisma.ledgerEntry.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.order.deleteMany();
  console.log("Cleared existing data");

  const specs: Array<{
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

  let total = 0;
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i++) {
      await createOrder({ status: spec.status, daysAgo: spec.daysAgo });
      total++;
    }
  }
  console.log(`Created ${total} orders`);

  // 4. Generate Daily Settlements for the past 7 days
  // Karena FK constraint ke Order sudah dicabut, kita bisa pakai aggregateId = settlement-YYYY-MM-DD
  const todayDate = new Date();
  for (let daysAgo = 7; daysAgo >= 0; daysAgo--) {
    const targetDate = new Date(todayDate.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const dateStr = targetDate.toISOString().split("T")[0]!;

    const startOfDay = new Date(`${dateStr}T00:00:00Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    const eligibleOrders = await prisma.order.findMany({
      where: {
        status: { in: ["FEE_CALCULATED", "SHIPPED", "DELIVERED"] },
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      select: { amount: true },
    });

    if (eligibleOrders.length > 0) {
      let totalRevenue = new Decimal(0);
      let totalFees = new Decimal(0);
      let totalPayout = new Decimal(0);

      for (const order of eligibleOrders) {
        const amt = new Decimal(order.amount.toString());
        const fee = amt.mul("0.03").toDecimalPlaces(4);
        totalRevenue = totalRevenue.add(amt);
        totalFees = totalFees.add(fee);
        totalPayout = totalPayout.add(amt.sub(fee));
      }

      await prisma.eventLog.create({
        data: {
          aggregateId: `settlement-${dateStr}`,
          eventType: "SettlementProcessed",
          payload: {
            type: "SettlementProcessed",
            date: dateStr,
            totalOrders: String(eligibleOrders.length),
            totalRevenue: totalRevenue.toFixed(4),
            totalFees: totalFees.toFixed(4),
            totalPayout: totalPayout.toFixed(4),
          },
          version: 1,
          idempotencyKey: `settlement-${dateStr}`,
          timestamp: new Date(endOfDay.getTime()), 
        },
      });

      console.log(`Created settlement for ${dateStr} (Orders: ${eligibleOrders.length}, Revenue: $${totalRevenue.toFixed(2)})`);
    }
  }

  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error(" Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
