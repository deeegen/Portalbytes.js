const cheerio = require("cheerio");
const { encrypt } = require("./crypto");

/**
 * Decide if a URL should be rewritten (http(s) and protocol-relative).
 * Skip data:, blob:, javascript:, mailto:, tel:, about: and fragment-only (#).
 */
function isSkippableUrl(orig) {
  if (!orig) return true;
  const trimmed = orig.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return true;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("about:")
  ) {
    return true;
  }
  return false;
}

function makeProxyUrl(absoluteUrl) {
  const enc = encodeURIComponent(encrypt(absoluteUrl));
  return "/proxy?u=" + enc;
}

/**
 * Convert an arbitrary URL (relative or absolute) into a proxied URL string.
 * If it should be skipped returns the original string.
 */
function rewriteUrl(orig, baseUrl) {
  if (!orig) return orig;
  if (isSkippableUrl(orig)) return orig;

  // If it's already proxied (very common), keep it as-is
  if (orig.startsWith("/proxy?u=") || orig.includes("/proxy?u=")) return orig;

  // Accept protocol-relative URLs //example.com
  let absolute;
  try {
    // Use URL with fallback to baseUrl
    absolute = new URL(orig, baseUrl).href;
  } catch (e) {
    // If URL constructor fails, just return original (safer)
    return orig;
  }

  return makeProxyUrl(absolute);
}

/**
 * Rewrite srcset attribute content (preserve descriptors like "2x" and "100w").
 * Example srcset: "a.jpg 1x, b.jpg 2x" or "small.jpg 300w, large.jpg 800w"
 */
function rewriteSrcset(srcsetVal, baseUrl) {
  if (!srcsetVal) return srcsetVal;
  // split by comma but keep possible commas inside url(...) — a simple split is usually fine for srcset
  // more robust parsers exist; this will handle typical srcset values.
  return srcsetVal
    .split(",")
    .map((item) => {
      const trimmed = item.trim();
      if (!trimmed) return "";
      // split on whitespace to separate URL from descriptor(s)
      const parts = trimmed.split(/\s+/);
      const urlPart = parts.shift();
      const descriptors = parts.join(" ");
      const newUrl = rewriteUrl(urlPart, baseUrl);
      return descriptors ? `${newUrl} ${descriptors}` : newUrl;
    })
    .join(", ");
}

/**
 * Rewrite CSS text (url(...) and @import '...') to proxy URLs.
 * Call this when you fetch external CSS content on the server and before sending it to the client.
 */
function rewriteCssUrls(cssText, baseUrl) {
  if (!cssText) return cssText;
  // rewrite url(...) occurrences
  cssText = cssText.replace(
    /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
    (m, quote, url) => {
      if (isSkippableUrl(url)) return `url(${quote}${url}${quote})`;
      const rewritten = rewriteUrl(url, baseUrl);
      return `url(${quote}${rewritten}${quote})`;
    }
  );

  // rewrite @import '...' or @import "..." or @import url(...)
  cssText = cssText.replace(
    /@import\s+(?:url\()?['"]?(.*?)['"]?\)?\s*;/gi,
    (m, url) => {
      if (isSkippableUrl(url)) return m;
      const rewritten = rewriteUrl(url, baseUrl);
      return `@import url('${rewritten}');`;
    }
  );

  return cssText;
}

/**
 * Entry: rewrite HTML string and return rewritten HTML.
 */
function rewriteHtmlLinks(html, baseUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // Respect <base href> if present
  const baseTagHref = $("base[href]").attr("href");
  if (baseTagHref) {
    try {
      baseUrl = new URL(baseTagHref, baseUrl).href;
    } catch (e) {
      // ignore and keep original baseUrl
    }
  }

  // attr sets to rewrite, with special handling where needed
  const attributesToRewrite = [
    { sel: "a[href]", attr: "href" },
    { sel: "link[href]", attr: "href" }, // stylesheets, icons - but remember: external CSS content must also be rewritten server-side
    { sel: "script[src]", attr: "src" },
    { sel: "img[src]", attr: "src" },
    { sel: "img[srcset]", attr: "srcset", type: "srcset" },
    { sel: "source[src]", attr: "src" }, // <source> for video/audio
    { sel: "source[srcset]", attr: "srcset", type: "srcset" },
    { sel: "video[poster]", attr: "poster" },
    { sel: "video[src]", attr: "src" },
    { sel: "audio[src]", attr: "src" },
    { sel: "iframe[src]", attr: "src" },
    { sel: "embed[src]", attr: "src" },
    { sel: "object[data]", attr: "data" },
    { sel: "form[action]", attr: "action" },
    { sel: "[data-src]", attr: "data-src" }, // common lazy-load attributes
    { sel: "[data-srcset]", attr: "data-srcset", type: "srcset" },
    { sel: "[poster]", attr: "poster" },
    { sel: "[background]", attr: "background" }, // legacy
    // add more attributes
  ];

  for (const mapping of attributesToRewrite) {
    $(mapping.sel).each((i, el) => {
      const $el = $(el);
      const val = $el.attr(mapping.attr);
      if (!val) return;
      if (mapping.type === "srcset") {
        $el.attr(mapping.attr, rewriteSrcset(val, baseUrl));
      } else {
        $el.attr(mapping.attr, rewriteUrl(val, baseUrl));
      }
    });
  }

  // rewrite inline styles on elements (e.g. style="background-image: url('...')")
  $("*[style]").each((i, el) => {
    const $el = $(el);
    const style = $el.attr("style");
    if (!style) return;
    const newStyle = style.replace(
      /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
      (m, quote, url) => {
        if (isSkippableUrl(url)) return m;
        return `url(${quote}${rewriteUrl(url, baseUrl)}${quote})`;
      }
    );
    $el.attr("style", newStyle);
  });

  // rewrite inline <style> tag contents
  $("style").each((i, el) => {
    const css = $(el).html();
    if (!css) return;
    $(el).html(rewriteCssUrls(css, baseUrl));
  });

  // rewrite meta refresh: <meta http-equiv="refresh" content="0;url=...">
  $("meta[http-equiv]").each((i, el) => {
    const $el = $(el);
    const httpEquiv = ($el.attr("http-equiv") || "").toLowerCase();
    if (httpEquiv === "refresh") {
      const content = $el.attr("content") || "";
      // typical format: "0; url=https://example.com"
      const m = content.match(/^\s*(\d+\s*);\s*url\s*=\s*(.*)\s*$/i);
      if (m) {
        const delay = m[1];
        const urlPart = m[2].replace(/^['"]|['"]$/g, ""); // strip quotes
        const newUrl = rewriteUrl(urlPart, baseUrl);
        $el.attr("content", `${delay}; url=${newUrl}`);
      }
    }
  });

  // Optionally: inject a small runtime helper to rewrite dynamic fetch/XHR calls
  // NOTE: injecting this may break some complex sites; leave commented or toggle via server option.
  /*
  const injection = `
  <script>
    (function(){
      var origFetch = window.fetch;
      window.fetch = function(input, init){
        try {
          var url = typeof input === 'string' ? input : (input && input.url);
          if (url && !url.includes('/proxy?u=') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('javascript:')) {
            // send through proxy endpoint (server should accept proxied fetches)
            var proxied = '/proxy?u=' + encodeURIComponent(url);
            if (typeof input === 'string') input = proxied;
            else input = new Request(proxied, input);
          }
        } catch(e){}
        return origFetch.call(this, input, init);
      };

      var OrigX = window.XMLHttpRequest;
      function ProxyXHR(){
        var x = new OrigX();
        var origOpen = x.open;
        x.open = function(method, url) {
          try {
            if (url && !url.includes('/proxy?u=') && !url.startsWith('data:') && !url.startsWith('blob:')) {
              url = '/proxy?u=' + encodeURIComponent(url);
            }
          } catch(e){}
          return origOpen.apply(this, [method, url].concat(Array.prototype.slice.call(arguments,2)));
        };
        return x;
      }
      ProxyXHR.prototype = OrigX.prototype;
      window.XMLHttpRequest = ProxyXHR;
    })();
  </script>
  `;
  $('head').prepend(injection);
  */

  return $.html();
}

module.exports = {
  rewriteHtmlLinks,
  rewriteCssUrls,
  rewriteSrcset,
};
