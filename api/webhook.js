function findValue(obj, keys) {
  if (!obj || typeof obj !== "object") return null;

  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findValue(value, keys);
      if (found !== null && found !== undefined) return found;
    }
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Prabhat Client Alerts"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const auth = req.headers.authorization || "";
  const expected = `Bearer ${process.env.HOSTINGER_WEBHOOK_SECRET}`;

  if (!process.env.HOSTINGER_WEBHOOK_SECRET || auth !== expected) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  let payload = req.body;

  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = { raw: payload };
    }
  }

  const sender =
    findValue(payload, ["from", "sender", "fromAddress", "email"]) ||
    "Unknown sender";

  const subject =
    findValue(payload, ["subject", "title"]) ||
    "No subject";

  const uidValue =
    findValue(payload, ["uid", "messageUid", "message_uid"]);

  const folder =
    findValue(payload, ["folder", "folderPath", "folder_path"]) ||
    "INBOX";

  const mailboxResourceId =
    findValue(payload, ["mailboxResourceId", "mailbox_resource_id"]) ||
    "ACfb6fa1592fa555fd693dd55ee8d8";

  let text = null;

  if (uidValue) {
    const uid = Number(uidValue);

    if (Number.isInteger(uid) && uid > 0) {
      const hostingerUrl =
        `https://api.mail.hostinger.com/api/v1/mailboxes/` +
        `${encodeURIComponent(mailboxResourceId)}/folders/` +
        `${encodeURIComponent(folder)}/messages/` +
        `${uid}/text`;

      const hostingerResponse = await fetch(hostingerUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.HOSTINGER_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      if (hostingerResponse.ok) {
        const hostingerData = await hostingerResponse.json();

        text =
          hostingerData?.data?.text ||
          hostingerData?.text ||
          null;
      }
    }
  }

  if (!text) {
    text =
      findValue(payload, ["text", "body", "content", "message"]) ||
      "No message preview";
  }

  const telegramMessage =
    `🔔 NEW CLIENT EMAIL\n\n` +
    `From: ${sender}\n` +
    `Subject: ${subject}\n\n` +
    `${String(text).slice(0, 3000)}`;

  const telegramResponse = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: "1214852821",
        text: telegramMessage
      })
    }
  );

  if (!telegramResponse.ok) {
    return res.status(502).json({
      ok: false,
      error: "Telegram delivery failed"
    });
  }

  return res.status(200).json({
    ok: true,
    message: "Telegram alert sent"
  });
};
