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

      return headers;
    },

    userResDecorator: (proxyRes, data, req) => {
      const contentType = (
        proxyRes.headers["content-type"] || ""
      ).toLowerCase();
      const baseUrl = new URL(getTargetUrl(req)).href;

      if (contentType.includes("text/html")) {
        const html = data.toString("utf8");
        let rewritten = rewriteHtmlLinks(html, baseUrl);

        // Title overwrite
        const $ = cheerio.load(rewritten, { decodeEntities: false });
        $("title").text("PB.JS - Viewing");
        rewritten = $.html();

        return rewritten;
      }

      if (contentType.includes("text/css")) {
        const css = data.toString("utf8");
        const rewrittenCss = rewriteCssUrls(css, baseUrl);
        return rewrittenCss;
      }

      // For binary / everything else (images, fonts, js, video): return untouched buffer
      return data;
    },
  }
);
