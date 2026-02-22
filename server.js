const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = 3000;
const API_KEY = "WNMXN9S-0HHM2DH-HX81DBR-PV48CBQ"; // put your NOWPayments key here
const PRICE = 50;

const allowedCryptos = ["bnb","sol","eth","ton","usdcspl"];

// Create payment
app.post("/create-payment", async (req, res) => {
  const { crypto } = req.body;

  if (!allowedCryptos.includes(crypto)) {
    return res.status(400).json({ error: "Invalid crypto" });
  }

  try {
    const response = await axios.post(
     "https://api.nowpayments.io/v1/invoice",
     {
  price_amount: PRICE,
  price_currency: "usd",
  pay_currency: crypto,
  order_id: "ORDER_" + Date.now(),
  order_description: "Premium Product",
  success_url: "http://localhost:3000",
  cancel_url: "http://localhost:3000"
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
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Payment creation failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});