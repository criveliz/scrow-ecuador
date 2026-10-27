import express from "express";
import paymentRouter from "./routes/payment.js";

const app = express();
app.use(express.json());

app.use("/api/v1/escrows", paymentRouter);

export default app;
