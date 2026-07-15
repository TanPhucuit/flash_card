import transcriptHandler from "./transcript.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  const requestUrl = new URL(request.url);
  const headers = new Headers();
  let body = "";
  const response = {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name, value);
    },
    end(value = "") {
      body = String(value);
    },
  };

  await transcriptHandler({
    method: request.method,
    query: { videoId: requestUrl.searchParams.get("videoId") ?? "" },
  }, response);

  return new Response(body, { status: response.statusCode, headers });
}
