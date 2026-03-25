const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;

const sessions = {};
const onlineUsers = {};

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getOnlineList() {
  return Object.entries(sessions)
    .filter(([t]) => onlineUsers[t])
    .map(([, name]) => name);
}

const httpServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("index.html not found"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end("Not found");
  }
});

const wss = new WebSocket.Server({ server: httpServer });

function broadcast(data, excludeToken = null) {
  const msg = JSON.stringify(data);
  Object.entries(onlineUsers).forEach(([token, ws]) => {
    if (token !== excludeToken && ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

wss.on("connection", (ws) => {
  let myToken = null;

  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === "join") {
      const username = String(data.username || "").trim().slice(0, 20);
      if (username.length < 2) {
        return ws.send(JSON.stringify({ type: "error", msg: "কমপক্ষে ২ অক্ষরের নাম দিন।" }));
      }
      const taken = Object.values(sessions).map(n => n.toLowerCase());
      if (taken.includes(username.toLowerCase())) {
        return ws.send(JSON.stringify({ type: "error", msg: "এই নামে কেউ আছেন, অন্য নাম দিন।" }));
      }
      const token = generateToken();
      myToken = token;
      sessions[token] = username;
      onlineUsers[token] = ws;
      ws.send(JSON.stringify({ type: "logged-in", username, token }));
      broadcast({ type: "user-joined", username, online: getOnlineList() }, token);
      ws.send(JSON.stringify({ type: "online-list", online: getOnlineList() }));
    }

    else if (data.type === "message") {
      if (!myToken || !sessions[myToken]) return;
      const username = sessions[myToken];
      const text = String(data.text || "").trim().slice(0, 1000);
      if (!text) return;
      const msgData = {
        type: "message", username, text,
        time: new Date().toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" })
      };
      const msg = JSON.stringify(msgData);
      Object.values(onlineUsers).forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
    }

    else if (data.type === "logout") {
      if (myToken) {
        const username = sessions[myToken];
        delete sessions[myToken]; delete onlineUsers[myToken];
        broadcast({ type: "user-left", username, online: getOnlineList() });
        myToken = null;
      }
    }
  });

  ws.on("close", () => {
    if (myToken && sessions[myToken]) {
      const username = sessions[myToken];
      delete onlineUsers[myToken]; delete sessions[myToken];
      broadcast({ type: "user-left", username, online: getOnlineList() });
      myToken = null;
    }
  });
});

httpServer.listen(PORT, () => {
  console.log("Server চালু: http://localhost:" + PORT);
});
