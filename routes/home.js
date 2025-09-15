// routes/home.js
const express = require("express");
const path = require("path");
const { encrypt } = require("../utils/crypto");
const router = express.Router();

const publicDir = path.join(__dirname, "../public");

/**
 * If the request to '/' contains a `url` query param, handle redirect/encrypt logic here.
 * We must check this *before* express.static because express.static will serve index.html
 * for '/' regardless of query string, which would block the redirect logic.
 */
router.get("/", (req, res, next) => {
  let { url } = req.query;

  // If no url query param, fall through to static file serving
  if (!url) return next();

  // Trim whitespace
  url = String(url).trim();

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

// Serve all static files in /public (CSS, JS, images, index.html, etc.)
router.use(express.static(publicDir));

module.exports = router;
