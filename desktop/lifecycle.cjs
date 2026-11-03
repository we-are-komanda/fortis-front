// The parent keeps stdin open. Closing/crashing the window also stops its local server.
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
const http = require("node:http");
const deadline = Date.now() + 60_000;
function probe() {
  const request = http.get(`http://127.0.0.1:${process.env.PORT}/api/runtime`, response => {
    let body = "";
    response.on("data", chunk => { body += chunk; });
    response.on("end", () => {
      try {
        if (response.statusCode === 200 && JSON.parse(body).mode === "demo") console.log("FORTIS_READY");
        else retry();
      } catch { retry(); }
    });
  });
  request.setTimeout(2000, () => request.destroy());
  request.on("error", retry);
}
function retry() {
  if (Date.now() > deadline) process.exit(1);
  else setTimeout(probe, 250);
}
setTimeout(probe, 250);
