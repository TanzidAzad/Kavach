// server/index.js — Role 3 (Agent & Backend)
// Contract: PRD section 8.5 — POST /api/chat, forwards to NVIDIA NIM with the key from .env.
// SKELETON STUB: does NOT call NVIDIA yet. Returns a mock chat-completions response.

const express = require("express");

const PORT = process.env.PORT || 8787;
const ALLOWED_MODELS = []; // TODO Role 3: fill in the Nemotron model IDs.

const app = express();
app.use(express.json({ limit: "10mb" }));

// CORS so the extension can call the server.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.post("/api/chat", (req, res) => {
  res.json({
    id: "mock-completion",
    object: "chat.completion",
    model: (req.body && req.body.model) || "mock",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Mock response from the Kavach proxy stub." },
        finish_reason: "stop"
      }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Kavach proxy (stub) on http://localhost:${PORT}`);
});
