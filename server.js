const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;

// ── In-memory store (সব data RAM-এ, restart করলে মুছে যায়) ──
const users = {};   // { username: hashedPassword }
const sessions = {}; // { token: username }
const onlineUsers = {}; // { token: ws }

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ── HTTP Server (index.html serve করবে) ──
const httpServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("index.html not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// ── WebSocket Server ──
const wss = new WebSocket.Server({ server: httpServer });

function broadcast(data, excludeToken = null) {
  const msg = JSON.stringify(data);
  Object.entries(onlineUsers).forEach(([token, ws]) => {
    if (token !== excludeToken && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

function getOnlineList() {
  return Object.values(sessions).filter(u =>
    Object.entries(sessions).some(([t, name]) => name === u && onlineUsers[t])
  );
}

wss.on("connection", (ws) => {
  let myToken = null;

  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // ── REGISTER ──
    if (data.type === "register") {
      const { username, password } = data;
      if (!username || !password || username.length < 2 || password.length < 4) {
        return ws.send(JSON.stringify({ type: "error", msg: "username কমপক্ষে ২ অক্ষর, password কমপক্ষে ৪ অক্ষর।" }));
      }
      if (users[username.toLowerCase()]) {
        return ws.send(JSON.stringify({ type: "error", msg: "এই username ইতিমধ্যে নেওয়া হয়েছে।" }));
      }
      users[username.toLowerCase()] = { displayName: username, hash: hashPassword(password) };
      ws.send(JSON.stringify({ type: "registered", msg: "একাউন্ট তৈরি হয়েছে! এখন login করুন।" }));
    }

    // ── LOGIN ──
    else if (data.type === "login") {
      const { username, password } = data;
      const user = users[username?.toLowerCase()];
      if (!user || user.hash !== hashPassword(password)) {
        return ws.send(JSON.stringify({ type: "error", msg: "username বা password ভুল।" }));
      }
      const token = generateToken();
      myToken = token;
      sessions[token] = user.displayName;
      onlineUsers[token] = ws;

      ws.send(JSON.stringify({ type: "logged-in", username: user.displayName, token }));
      broadcast({ type: "user-joined", username: user.displayName, online: getOnlineList() }, token);
      ws.send(JSON.stringify({ type: "online-list", online: getOnlineList() }));
    }

    // ── CHAT MESSAGE ──
    else if (data.type === "message") {
      if (!myToken || !sessions[myToken]) return;
      const username = sessions[myToken];
      const text = String(data.text || "").trim().slice(0, 1000);
      if (!text) return;

      const msgData = {
        type: "message",
        username,
        text,
        time: new Date().toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" })
      };
      // সবাইকে পাঠাও (নিজেকেও)
      const msg = JSON.stringify(msgData);
      Object.values(onlineUsers).forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
      });
    }

    // ── LOGOUT ──
    else if (data.type === "logout") {
      if (myToken) {
        const username = sessions[myToken];
        delete sessions[myToken];
        delete onlineUsers[myToken];
        broadcast({ type: "user-left", username, online: getOnlineList() });
        myToken = null;
      }
    }
  });

  ws.on("close", () => {
    if (myToken && sessions[myToken]) {
      const username = sessions[myToken];
      delete onlineUsers[myToken];
      delete sessions[myToken];
      broadcast({ type: "user-left", username, online: getOnlineList() });
      myToken = null;
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server চালু: http://localhost:${PORT}`);
});
