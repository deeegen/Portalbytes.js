const express = require("express");
const path = require("path");
const { encrypt } = require("../utils/crypto");
const router = express.Router();

router.get("/", (req, res) => {
  let { url } = req.query;

  if (!url) {
    return res.sendFile(path.join(__dirname, "../public/index.html"));
  }

  // Trim whitespace
  url = url.trim();

  // Regex to check if it looks like a domain or has a protocol
  const hasProtocol = /^https?:\/\//i.test(url);
  const looksLikeDomain = /^[\w.-]+\.[a-z]{2,}$/i.test(url);

  if (!hasProtocol && !looksLikeDomain) {
    // Treat as search query -> DuckDuckGo HTML endpoint
    url = "https://duckduckgo.com/html/?q=" + encodeURIComponent(url);
  } else {
    // If no protocol but looks like domain, prepend http://
    if (!hasProtocol) {
      url = "http://" + url;
    }
  }

  const encrypted = encodeURIComponent(encrypt(url));
  return res.redirect("/proxy?u=" + encrypted);
});

module.exports = router;
