const express = require("express");
const proxyMiddleware = require("../utils/proxyConfig");

const router = express.Router();
router.use("/", proxyMiddleware);

module.exports = router;
