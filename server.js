const express = require("express");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto"); // ← added this
const bodyParser = require("body-parser");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = 3000;
const API_KEY = "WNMXN9S-0HHM2DH-HX81DBR-PV48CBQ";
const IPN_SECRET = "sw7lXijU32SHToL4rzhLdZ0uYb10Mxw3";

// ================= DATABASE =================

const db = new sqlite3.Database("./payments.db");

db.run(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE,
    ticket_type TEXT,
    crypto TEXT,
    price REAL,
    payment_status TEXT DEFAULT 'waiting',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ================= CONFIG =================

const ticketPrices = {
  vip: 120,
  viplux: 180,
  regshare: 60,
  regsingle: 80
};

const allowedCryptos = [
  "usdtsol", "usdtbsc", "usdteth",
  "usdcspl", "usdcbsc", "usdceth", "usdcbase",
  "sol", "bnb", "eth", "base"
];

// ================= CREATE PAYMENT =================

app.post("/api/create-payment", async (req, res) => {
  const { ticketType, crypto } = req.body;

  if (!ticketPrices[ticketType]) {
    return res.status(400).json({ error: "Invalid ticket type" });
  }

  if (!allowedCryptos.includes(crypto)) {
    return res.status(400).json({ error: "Invalid crypto" });
  }

  const price = ticketPrices[ticketType];
  const orderId = `ORDER_${ticketType}_${Date.now()}`;

  try {
    // 1️⃣ Save order in DB first (with error handling)
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO orders (order_id, ticket_type, crypto, price) VALUES (?, ?, ?, ?)`,
        [orderId, ticketType, crypto, price],
        function (err) {
          if (err) return reject(err);
          resolve();
        }
      );
    });

    // 2️⃣ Create invoice
    const response = await axios.post(
      "https://api.nowpayments.io/v1/invoice",
      {
        price_amount: price,
        price_currency: "usd",
        pay_currency: crypto,
        order_id: orderId,
        order_description: `${ticketType.toUpperCase()} Ticket`,
        success_url: "http://localhost:3000/success.html",
        cancel_url: "http://localhost:3000/cancel.html"
      },
      {
        headers: {
          "x-api-key": API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({ invoice_url: response.data.invoice_url });
  } catch (error) {
    console.error("Payment creation failed:", error.response?.data || error.message);
    res.status(500).json({ error: "Payment creation failed" });
  }
});

// ================= WEBHOOK =================

app.post(
  "/api/payment-webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const receivedSig = req.headers["x-nowpayments-sig"]?.toLowerCase();
      if (!receivedSig) return res.status(401).send("Missing signature");

      const rawBody = req.body.toString("utf8");
      const body = JSON.parse(rawBody);

      const sortedJson = JSON.stringify(body, Object.keys(body).sort());
      const computedSig = crypto
        .createHmac("sha512", IPN_SECRET)
        .update(sortedJson)
        .digest("hex")
        .toLowerCase();

      if (receivedSig !== computedSig) {
        console.warn("Webhook signature invalid", { order_id: body.order_id });
        return res.status(401).send("Invalid signature");
      }

      const { order_id, payment_status } = body;

     if (payment_status === "finished") {

  // 1️⃣ Get order from DB
  const order = await new Promise((resolve, reject) => {
    db.get(
      `SELECT payment_status FROM orders WHERE order_id = ?`,
      [order_id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row);
      }
    );
  });

  if (!order) {
    console.log("Order not found:", order_id);
    return res.sendStatus(200);
  }

  // 2️⃣ Prevent duplicate processing
  if (order.payment_status === "finished" || order.payment_status === "ticket_issued") {
    console.log("Duplicate confirmation blocked:", order_id);
    return res.sendStatus(200);
  }

  // 3️⃣ Update status to finished
  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE orders SET payment_status = 'finished' WHERE order_id = ?`,
      [order_id],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });

  console.log("Payment marked as finished:", order_id);

  // 4️⃣ Issue ticket
  issueTicket(order_id);
}
      res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err);
      res.sendStatus(200); // still ack to NOWPayments – don't block their retries
    }
  }
);
// ================= STATUS CHECK =================

app.get("/api/check-payment/:orderId", (req, res) => {
  const { orderId } = req.params;

  db.get(
    `SELECT payment_status FROM orders WHERE order_id = ?`,
    [orderId],
    (err, row) => {
      if (err) {
        console.error("Check payment DB error:", err);
        return res.status(500).json({ error: "Database error" });
      }
      if (!row) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json({ status: row.payment_status });
    }
  );
});

// ================= TICKET ISSUANCE =================

function issueTicket(orderId) {
  console.log("Issuing ticket for:", orderId);

  // TODO: generate QR, send email, create download link, etc.

  db.run(
    `UPDATE orders SET payment_status = 'ticket_issued' WHERE order_id = ?`,
    [orderId],
    (err) => {
      if (err) {
        console.error("Failed to mark ticket as issued:", orderId, err);
      } else {
        console.log("Ticket marked as issued:", orderId);
      }
    }
  );
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});