const express = require("express");
const session = require("./config/session");
const homeRoute = require("./routes/home");
const proxyRoute = require("./routes/proxy");

const app = express();

// Session middleware
app.use(session);

// Routes
app.use("/", homeRoute);
app.use("/proxy", proxyRoute);

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`mini-web-proxy on port ${PORT}`);
});
