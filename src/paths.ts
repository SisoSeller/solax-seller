export function asset(path: string) {
  const clean = path.replace(/^\//, "");
  return `${import.meta.env.BASE_URL}${clean}`;
}

export function siteOriginPath() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  let path = url.pathname.replace(/index\.html$/, "").replace(/sell\.html$/, "sell.html");
  if (!path.endsWith(".html") && !path.endsWith("/")) path += "/";
  return `${url.origin}${path}`;
}
