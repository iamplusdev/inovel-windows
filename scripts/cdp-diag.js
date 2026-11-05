/* CDP 诊断：连接 127.0.0.1:9222 的 iNovel 页面，查询服务端书籍进度数据。只读。 */
const http = require("node:http");

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9222/json", (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve(JSON.parse(buf)));
    }).on("error", reject);
  });
}

async function main() {
  const targets = await getTargets();
  const page = targets.find((t) => t.type === "page" && /iNovel|index/.test(t.title));
  if (!page) throw new Error("page target not found: " + JSON.stringify(targets.map((t) => t.title)));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evalJS = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails) return { exception: r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };

  const hash = await evalJS("location.hash");
  console.log("[hash]", hash);

  const book = await evalJS(
    `window.api ? window.api.getBook(27).then(v => ({ok:true, v})).catch(e => ({ok:false, err:String(e)})) : "no window.api"`,
  );
  console.log("[book27]", JSON.stringify(book, null, 1).slice(0, 800));

  const local = await evalJS(
    `window.api ? window.api.loadLocalProgress(27).then(v => JSON.stringify(v)) : "no api"`,
  );
  console.log("[local27]", local);

  const toc = await evalJS(
    `window.api ? window.api.getToc(27, 1, 5).then(v => ({total: v.total, head: v.items.slice(0,5).map(c => ({id:c.id, index:c.index, name:(c.name||c.title||'').slice(0,14)}))})) : "no api"`,
  );
  console.log("[toc27]", JSON.stringify(toc));

  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("[diag]", e);
  process.exit(1);
});
