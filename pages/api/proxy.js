// Serverless proxy: browser → this route → Cornerstone. No browser CORS.
export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { baseUrl, path, bearerToken, query, expectBlob } = req.body || {};

  if (!baseUrl || !path || !bearerToken) {
    res.status(400).json({ error: "baseUrl, path, and bearerToken are required." });
    return;
  }

  try {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}${path}`);
    if (query && typeof query === "object") {
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      });
    }

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: expectBlob ? "text/csv, application/octet-stream, */*" : "application/json",
      },
    });

    const contentType = upstream.headers.get("content-type") || "";
    const statusInfo = { status: upstream.status, statusText: upstream.statusText };

    if (expectBlob) {
      const arrayBuffer = await upstream.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      if (!upstream.ok) {
        res.status(200).json({ ok: false, ...statusInfo, error: "Upstream returned non-2xx", body: base64.slice(0, 500) });
        return;
      }
      res.status(200).json({ ok: true, ...statusInfo, contentType, base64 });
      return;
    }

    let body;
    if (contentType.includes("application/json")) {
      body = await upstream.json().catch(() => null);
    } else {
      body = await upstream.text().catch(() => "");
    }

    if (!upstream.ok) {
      res.status(200).json({ ok: false, ...statusInfo, body });
      return;
    }

    res.status(200).json({ ok: true, ...statusInfo, body });
  } catch (error) {
    res.status(200).json({ ok: false, status: 0, statusText: "Proxy error", error: error.message });
  }
}
