// Save Set-Cookie headers into session cookie jar
function storeCookies(setCookie, origin, session) {
  session.cookieJar = session.cookieJar || {};
  session.cookieJar[origin] = session.cookieJar[origin] || {};

  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  cookies.forEach((str) => {
    const [cookieKV] = str.split(";");
    const [name, val] = cookieKV.split("=");
    session.cookieJar[origin][name.trim()] = val.trim();
  });
}

// Get "Cookie" header string from session cookie jar
function getCookieHeader(origin, session) {
  const jar = session.cookieJar || {};
  const cookies = jar[origin];
  if (!cookies) return undefined;

  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

module.exports = { storeCookies, getCookieHeader };
