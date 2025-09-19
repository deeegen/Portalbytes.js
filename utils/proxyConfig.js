// utils/proxyConfig.js
const proxy = require("express-http-proxy");
const cheerio = require("cheerio");
const { storeCookies, getCookieHeader } = require("./cookieHandler");
const { rewriteHtmlLinks, rewriteCssUrls } = require("./urlRewrite");
const { encrypt, decrypt } = require("./crypto");

function getTargetUrl(req) {
  if (req.query.u) return decrypt(req.query.u);
  return req.query.url;
}

module.exports = proxy(
  (req) => {
    const targetUrl = new URL(getTargetUrl(req));
    return targetUrl.origin;
  },
  {
    proxyReqPathResolver: (req) => {
      const u = new URL(getTargetUrl(req));
      return u.pathname + u.search;
    },

    proxyReqOptDecorator: (opts, req) => {
      opts.headers["user-agent"] =
        req.session.userAgent || req.headers["user-agent"];

      const cookieHeader = getCookieHeader(
        new URL(getTargetUrl(req)).origin,
        req.session
      );
      if (cookieHeader) opts.headers["Cookie"] = cookieHeader;

      return opts;
    },

    userResHeaderDecorator: (headers, req) => {
      const origin = new URL(getTargetUrl(req)).origin;

      // Store target cookies in session
      if (headers["set-cookie"]) {
        storeCookies(headers["set-cookie"], origin, req.session);
        delete headers["set-cookie"];
      }

      // Rewrite redirect Location headers
      if (headers.location) {
        let loc = headers.location;
        if (!/^https?:/i.test(loc)) {
          if (loc.startsWith("//")) {
            loc = new URL(getTargetUrl(req)).protocol + loc;
          } else {
            loc = origin + (loc.startsWith("/") ? "" : "/") + loc;
          }
        }
        const enc = encodeURIComponent(encrypt(loc));
        headers.location = "/proxy?u=" + enc;
      }

      // Remove CSP so images/scripts/styles from proxied site can load
      delete headers["content-security-policy"];
      delete headers["content-security-policy-report-only"];

      // Allow partial content for media
      headers["accept-ranges"] = "bytes";

      return headers;
    },

    userResDecorator: (proxyRes, data, req, res) => {
      const contentType = (
        proxyRes.headers["content-type"] || ""
      ).toLowerCase();
      const baseUrl = new URL(getTargetUrl(req)).href;

      // Streaming for video/audio with Range support
      if (
        contentType.startsWith("video/") ||
        contentType.startsWith("audio/")
      ) {
        const range = req.headers.range;
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (range) {
          const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
          const start = parseInt(startStr, 10) || 0;
          const end = endStr ? parseInt(endStr, 10) : buffer.length - 1;

          res.status(206);
          res.setHeader(
            "Content-Range",
            `bytes ${start}-${end}/${buffer.length}`
          );
          res.setHeader("Content-Length", end - start + 1);
          res.setHeader("Accept-Ranges", "bytes");
          return buffer.slice(start, end + 1);
        }
        return buffer;
      }

      // HTML
      if (contentType.includes("text/html")) {
        const html = data.toString("utf8");
        let rewritten = rewriteHtmlLinks(html, baseUrl);

        const $ = cheerio.load(rewritten, { decodeEntities: false });
        $("title").text("PB.JS - Viewing");

        // Inject runtime script for dynamic fetch/XHR/WebSocket/window/document rewriting
        const injection = `
<script>
(function(){
  // Rewrite fetch
  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input : input?.url;
    if(url && !url.includes('/proxy?u=') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('javascript:')) {
      url = '/proxy?u=' + encodeURIComponent(url);
      if(typeof input === 'string') input = url;
      else input = new Request(url, input);
    }
    return origFetch.call(this, input, init);
  };

  // Rewrite XHR
  const OrigX = window.XMLHttpRequest;
  function ProxyXHR() {
    const x = new OrigX();
    const origOpen = x.open;
    x.open = function(method, url) {
      if(url && !url.includes('/proxy?u=') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        url = '/proxy?u=' + encodeURIComponent(url);
      }
      return origOpen.apply(this, [method, url, ...Array.prototype.slice.call(arguments,2)]);
    };
    return x;
  }
  ProxyXHR.prototype = OrigX.prototype;
  window.XMLHttpRequest = ProxyXHR;

  // Rewrite WebSocket
  const OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    if(url && !url.includes('/proxy?u=')) {
      url = '/proxy?u=' + encodeURIComponent(url);
    }
    return new OrigWS(url, protocols);
  };

  // Proxy window.location assignments
  const loc = window.location;
  Object.defineProperty(window, 'location', {
    set: function(val) {
      if(val && !val.includes('/proxy?u=')) val = '/proxy?u=' + encodeURIComponent(val);
      loc.href = val;
    },
    get: function() { return loc.href; }
  });

  // Proxy document.domain
  let docDomain = document.domain;
  Object.defineProperty(document, 'domain', {
    set: function(val) { docDomain = val; },
    get: function() { return docDomain; }
  });

  // Observe <base> tag changes dynamically
  new MutationObserver((mutations) => {
    mutations.forEach(m => {
      if(m.type === 'attributes' && m.target.tagName === 'BASE') {
        console.log('Base href updated to', m.target.href);
      }
    });
  }).observe(document.head, { attributes: true, subtree: true });
})();
</script>
`;
        $("head").prepend(injection);

        return $.html();
      }

      // CSS
      if (contentType.includes("text/css")) {
        const css = data.toString("utf8");
        return rewriteCssUrls(css, baseUrl);
      }

      // Binary / everything else: return untouched
      return data;
    },

    // Gandle WebSocket upgrade proxying
    proxyErrorHandler: (err, res, next) => {
      console.error("Proxy error:", err);
      res.status(500).send("Proxy error");
    },
  }
);
