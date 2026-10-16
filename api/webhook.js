const MAILBOX_RESOURCE_ID =
  process.env.HOSTINGER_MAILBOX_RESOURCE_ID ||
  "ACfb6fa1592fa555fd693dd55ee8d8";

const DEFAULT_FOLDER = "INBOX";
const TELEGRAM_CHAT_ID = "1214852821";

// Best-effort duplicate protection for warm Vercel instances.
// Durable duplicate protection can be added later with a database/KV.
const processedMessages = globalThis.__processedClientMessages ||
  (globalThis.__processedClientMessages = new Map());

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
      if (found !== null && found !== undefined) {
        return found;
      }
    }
  }

  return null;
}

function findAllValues(obj, keys, results = []) {
  if (!obj || typeof obj !== "object") {
    return results;
  }

  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      results.push(obj[key]);
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      findAllValues(value, keys, results);
    }
  }

  return results;
}

function normalizeEmail(value) {
  if (!value) return "";

  if (typeof value === "string") {
    const match = value.match(/<([^>]+)>/);
    return (match ? match[1] : value).trim().toLowerCase();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeEmail(item))
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "object") {
    return String(
      value.address ||
      value.email ||
      value.mail ||
      ""
    )
      .trim()
      .toLowerCase();
  }

  return "";
}

function displayAddress(value) {
  if (!value) return "Unknown";

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map(displayAddress)
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "object") {
    const name = String(value.name || "").trim();
    const address = String(
      value.address ||
      value.email ||
      ""
    ).trim();

    if (name && address) {
      return `${name} <${address}>`;
    }

    return address || name || "Unknown";
  }

  return String(value);
}

function stripHtml(html) {
  if (!html) return "";

  let text = String(html);

  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");

  text = decodeHtmlEntities(text);

  text = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : _;
    });
}

function cleanMessageText(text) {
  if (!text) return "";

  let value = String(text);

  // Remove HTML tags that may remain inside "plain text"
  // responses from the mail API.
  value = value.replace(/<[^>]*>/g, " ");

  // Decode common HTML entities.
  value = decodeHtmlEntities(value);

  value = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();

  return value;
}

function formatReceivedTime(value) {
  if (!value) return "Unknown";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(date);
}

function isLikelyUid(value) {
  const uid = Number(value);
  return Number.isInteger(uid) && uid > 0;
}

function extractUid(payload) {
  const values = findAllValues(payload, [
    "uid",
    "messageUid",
    "message_uid"
  ]);

  for (const value of values) {
    if (isLikelyUid(value)) {
      return Number(value);
    }
  }

  return null;
}

function extractFolder(payload) {
  return (
    findValue(payload, [
      "folder",
      "folderPath",
      "folder_path",
      "path"
    ]) ||
    DEFAULT_FOLDER
  );
}

function extractMessageId(payload) {
  return (
    findValue(payload, [
      "messageId",
      "message_id",
      "Message-ID",
      "messageID",
      "rfc822MessageId"
    ]) ||
    null
  );
}

function extractSubject(payload) {
  return (
    findValue(payload, [
      "subject",
      "title"
    ]) ||
    "No subject"
  );
}

function extractSender(payload) {
  return (
    findValue(payload, [
      "from",
      "sender",
      "fromAddress",
      "from_address"
    ]) ||
    "Unknown sender"
  );
}

function extractRecipient(payload) {
  return (
    findValue(payload, [
      "to",
      "recipient",
      "toAddress",
      "to_address"
    ]) ||
    "contact@prabhat.online"
  );
}

function extractReceivedDate(payload) {
  return (
    findValue(payload, [
      "date",
      "receivedAt",
      "received_at",
      "timestamp",
      "createdAt",
      "created_at"
    ]) ||
    null
  );
}

function extractBodyFromPayload(payload) {
  const text =
    findValue(payload, [
      "text",
      "plainText",
      "plain_text",
      "bodyText",
      "body_text"
    ]);

  if (text && typeof text === "string" && text.trim()) {
    return cleanMessageText(text);
  }

  const body =
    findValue(payload, [
      "body",
      "content",
      "message"
    ]);

  if (typeof body === "string" && body.trim()) {
    return cleanMessageText(body);
  }

  if (body && typeof body === "object") {
    const nestedText =
      body.text ||
      body.plainText ||
      body.plain_text ||
      body.content;

    if (nestedText) {
      return cleanMessageText(nestedText);
    }

    const nestedHtml =
      body.html ||
      body.htmlBody ||
      body.html_body;

    if (nestedHtml) {
      return stripHtml(nestedHtml);
    }
  }

  const html =
    findValue(payload, [
      "html",
      "htmlBody",
      "html_body"
    ]);

  if (html) {
    return stripHtml(html);
  }

  return "";
}

function getAttachmentList(message) {
  const attachments =
    message?.attachments ||
    message?.data?.attachments ||
    [];

  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") {
        return null;
      }

      return (
        attachment.filename ||
        attachment.name ||
        attachment.fileName ||
        attachment.title ||
        null
      );
    })
    .filter(Boolean);
}

function buildMessageKey({
  messageId,
  uid,
  sender,
  subject,
  receivedDate
}) {
  if (messageId) {
    return `message-id:${String(messageId).trim().toLowerCase()}`;
  }

  if (uid) {
    return `uid:${uid}`;
  }

  return [
    "fallback",
    normalizeEmail(sender),
    String(subject || "").trim().toLowerCase(),
    String(receivedDate || "")
  ].join("|");
}

function wasRecentlyProcessed(key) {
  if (!key) return false;

  const now = Date.now();

  for (const [storedKey, timestamp] of processedMessages.entries()) {
    if (now - timestamp > 30 * 60 * 1000) {
      processedMessages.delete(storedKey);
    }
  }

  return processedMessages.has(key);
}

function markProcessed(key) {
  if (!key) return;

  processedMessages.set(key, Date.now());

  // Keep memory bounded.
  if (processedMessages.size > 500) {
    const firstKey = processedMessages.keys().next().value;

    if (firstKey) {
      processedMessages.delete(firstKey);
    }
  }
}

async function hostingerRequest(url, options = {}) {
  const token = process.env.HOSTINGER_API_TOKEN;

  if (!token) {
    throw new Error("HOSTINGER_API_TOKEN is not configured");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return {
    response,
    data
  };
}

async function getMessageText({
  mailboxResourceId,
  folder,
  uid
}) {
  if (!isLikelyUid(uid)) {
    return null;
  }

  const url =
    `https://api.mail.hostinger.com/api/v1/mailboxes/` +
    `${encodeURIComponent(mailboxResourceId)}/folders/` +
    `${encodeURIComponent(folder)}/messages/` +
    `${uid}/text`;

  const { response, data } = await hostingerRequest(url);

  if (!response.ok) {
    console.error(
      "[HOSTINGER] message text fetch failed:",
      response.status
    );

    return null;
  }

  const text =
    data?.data?.text ||
    data?.text ||
    "";

  const html =
    data?.data?.html ||
    data?.html ||
    "";

  if (text && String(text).trim()) {
    return cleanMessageText(text);
  }

  if (html && String(html).trim()) {
    return stripHtml(html);
  }

  return null;
}

async function getMessageDetails({
  mailboxResourceId,
  folder,
  uid
}) {
  if (!isLikelyUid(uid)) {
    return null;
  }

  const url =
    `https://api.mail.hostinger.com/api/v1/mailboxes/` +
    `${encodeURIComponent(mailboxResourceId)}/folders/` +
    `${encodeURIComponent(folder)}/messages/` +
    `${uid}`;

  const { response, data } = await hostingerRequest(url);

  if (!response.ok) {
    console.error(
      "[HOSTINGER] message details fetch failed:",
      response.status
    );

    return null;
  }

  return data?.data || data || null;
}

async function searchForMessage({
  mailboxResourceId,
  folder,
  messageId,
  subject,
  sender,
  receivedDate
}) {
  const baseUrl =
    `https://api.mail.hostinger.com/api/v1/mailboxes/` +
    `${encodeURIComponent(mailboxResourceId)}/folders/` +
    `${encodeURIComponent(folder)}/messages/search`;

  // Best match: RFC Message-ID.
  if (messageId) {
    const result = await hostingerRequest(baseUrl, {
      method: "POST",
      body: JSON.stringify({
        text: String(messageId),
        page: 1,
        perPage: 10,
        sort: "-uid"
      })
    });

    if (result.response.ok) {
      const messages = result.data?.data || [];

      const exact = messages.find(
        (message) =>
          String(message?.messageId || "").trim().toLowerCase() ===
          String(messageId).trim().toLowerCase()
      );

      if (exact?.uid) {
        return exact;
      }

      if (messages[0]?.uid) {
        return messages[0];
      }
    }
  }

  // Second option: search subject.
  if (subject && subject !== "No subject") {
    const result = await hostingerRequest(baseUrl, {
      method: "POST",
      body: JSON.stringify({
        subject: String(subject).slice(0, 1024),
        page: 1,
        perPage: 25,
        sort: "-uid"
      })
    });

    if (result.response.ok) {
      const messages = result.data?.data || [];

      const normalizedSubject =
        String(subject).trim().toLowerCase();

      const normalizedSender =
        normalizeEmail(sender);

      const candidates = messages
        .filter((message) => {
          const messageSubject =
            String(message?.subject || "")
              .trim()
              .toLowerCase();

          const messageSender =
            normalizeEmail(message?.from);

          const subjectMatches =
            messageSubject === normalizedSubject;

          const senderMatches =
            !normalizedSender ||
            !messageSender ||
            messageSender === normalizedSender;

          return subjectMatches && senderMatches;
        })
        .sort((a, b) => {
          const aTime = new Date(a?.date || 0).getTime();
          const bTime = new Date(b?.date || 0).getTime();

          return bTime - aTime;
        });

      if (candidates[0]?.uid) {
        return candidates[0];
      }

      if (messages[0]?.uid) {
        return messages[0];
      }
    }
  }

  // Last fallback: recent messages and compare locally.
  const result = await hostingerRequest(
    `${baseUrl}?page=1&perPage=25&sort=-uid`
  );

  if (result.response.ok) {
    const messages = result.data?.data || [];

    const normalizedSubject =
      String(subject || "")
        .trim()
        .toLowerCase();

    const normalizedSender =
      normalizeEmail(sender);

    const candidates = messages.filter((message) => {
      const messageSubject =
        String(message?.subject || "")
          .trim()
          .toLowerCase();

      const messageSender =
        normalizeEmail(message?.from);

      const subjectMatches =
        !normalizedSubject ||
        normalizedSubject === "no subject" ||
        messageSubject === normalizedSubject;

      const senderMatches =
        !normalizedSender ||
        messageSender === normalizedSender;

      return subjectMatches && senderMatches;
    });

    if (candidates[0]?.uid) {
      return candidates[0];
    }
  }

  return null;
}

function splitTelegramText(text, maxLength = 3800) {
  const value = String(text || "");

  if (value.length <= maxLength) {
    return [value];
  }

  const chunks = [];
  let remaining = value;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);

    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }

    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true
      })
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || !data?.ok) {
    console.error(
      "[TELEGRAM] send failed:",
      response.status
    );

    throw new Error("Telegram delivery failed");
  }

  return data;
}

function buildTelegramMessages({
  sender,
  recipient,
  subject,
  receivedDate,
  body,
  attachments
}) {
  const header =
    `🔔 NEW CLIENT EMAIL\n\n` +
    `From: ${displayAddress(sender)}\n` +
    `To: ${displayAddress(recipient)}\n` +
    `Subject: ${String(subject || "No subject")}\n` +
    `Received: ${formatReceivedTime(receivedDate)}\n\n` +
    `Message:\n\n`;

  const attachmentText =
    attachments.length > 0
      ? `\n\n📎 Attachments:\n${attachments
          .map((name) => `• ${name}`)
          .join("\n")}`
      : "";

  const fullText =
    header +
    (body || "No message body found.") +
    attachmentText;

  return splitTelegramText(fullText);
}

module.exports = async function handler(req, res) {
  // Health check
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Prabhat Client Alerts",
      version: "2.0"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  // --------------------------------------------------
  // 1. Verify Hostinger webhook
  // --------------------------------------------------

  const auth = req.headers.authorization || "";
  const secret = process.env.HOSTINGER_WEBHOOK_SECRET;

  if (!secret) {
    console.error("[WEBHOOK] HOSTINGER_WEBHOOK_SECRET missing");

    return res.status(500).json({
      ok: false,
      error: "Webhook secret is not configured"
    });
  }

  const expectedAuth = `Bearer ${secret}`;

  if (auth !== expectedAuth) {
    console.error("[WEBHOOK] Unauthorized request");

    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  // --------------------------------------------------
  // 2. Parse payload
  // --------------------------------------------------

  let payload = req.body;

  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {
        raw: payload
      };
    }
  }

  if (!payload || typeof payload !== "object") {
    return res.status(400).json({
      ok: false,
      error: "Invalid webhook payload"
    });
  }

  // --------------------------------------------------
  // 3. Extract webhook information
  // --------------------------------------------------

  let folder = extractFolder(payload);

  const payloadUid = extractUid(payload);

  const payloadMessageId =
    extractMessageId(payload);

  const payloadSubject =
    extractSubject(payload);

  const payloadSender =
    extractSender(payload);

  const payloadRecipient =
    extractRecipient(payload);

  const payloadReceivedDate =
    extractReceivedDate(payload);

  let uid = payloadUid;
  let messageId = payloadMessageId;
  let subject = payloadSubject;
  let sender = payloadSender;
  let recipient = payloadRecipient;
  let receivedDate = payloadReceivedDate;
  let messageDetails = null;

  console.log(
    "[WEBHOOK] Received:",
    JSON.stringify({
      uid: uid || null,
      messageId: messageId || null,
      subject,
      folder
    })
  );

  // --------------------------------------------------
  // 4. If UID is missing, locate the message
  // --------------------------------------------------

  if (!uid) {
    console.log(
      "[WEBHOOK] UID not found. Searching Hostinger Mail API..."
    );

    const found = await searchForMessage({
      mailboxResourceId: MAILBOX_RESOURCE_ID,
      folder,
      messageId,
      subject,
      sender,
      receivedDate
    });

    if (found) {
      uid = Number(found.uid);

      folder = found.path || folder;

      messageId =
        found.messageId ||
        messageId;

      subject =
        found.subject ||
        subject;

      sender =
        found.from ||
        sender;

      recipient =
        found.to ||
        recipient;

      receivedDate =
        found.date ||
        receivedDate;

      messageDetails = found;

      console.log(
        "[WEBHOOK] Message located. UID:",
        uid
      );
    } else {
      console.error(
        "[WEBHOOK] Could not locate message in Hostinger"
      );
    }
  }

  // --------------------------------------------------
  // 5. Fetch full message details
  // --------------------------------------------------

  if (uid) {
    const details = await getMessageDetails({
      mailboxResourceId: MAILBOX_RESOURCE_ID,
      folder,
      uid
    });

    if (details) {
      messageDetails = details;

      messageId =
        details.messageId ||
        messageId;

      subject =
        details.subject ||
        subject;

      sender =
        details.from ||
        sender;

      recipient =
        details.to ||
        recipient;

      receivedDate =
        details.date ||
        receivedDate;

      console.log(
        "[HOSTINGER] Message details loaded. UID:",
        uid
      );
    }
  }

  // --------------------------------------------------
  // 6. Duplicate protection
  // --------------------------------------------------

  const messageKey = buildMessageKey({
    messageId,
    uid,
    sender,
    subject,
    receivedDate
  });

  if (wasRecentlyProcessed(messageKey)) {
    console.log(
      "[WEBHOOK] Duplicate event ignored:",
      messageKey
    );

    return res.status(200).json({
      ok: true,
      duplicate: true,
      message: "Duplicate webhook ignored"
    });
  }

  // --------------------------------------------------
  // 7. Get complete email body
  // --------------------------------------------------

  let body =
    extractBodyFromPayload(payload);

  if (uid) {
    const hostingerText =
      await getMessageText({
        mailboxResourceId: MAILBOX_RESOURCE_ID,
        folder,
        uid
      });

    if (hostingerText) {
      body = hostingerText;

      console.log(
        "[HOSTINGER] Complete email body fetched. Length:",
        body.length
      );
    } else {
      console.error(
        "[HOSTINGER] Complete email body could not be fetched"
      );
    }
  }

  body = cleanMessageText(body);

  // --------------------------------------------------
  // 8. Attachment information
  // --------------------------------------------------

  const attachments =
    getAttachmentList(messageDetails);

  // --------------------------------------------------
  // 9. Mark as processed
  // --------------------------------------------------

  markProcessed(messageKey);

  // --------------------------------------------------
  // 10. Build Telegram messages
  // --------------------------------------------------

  const telegramMessages =
    buildTelegramMessages({
      sender,
      recipient,
      subject,
      receivedDate,
      body,
      attachments
    });

  // --------------------------------------------------
  // 11. Send complete email to Telegram
  // --------------------------------------------------

  try {
    for (const message of telegramMessages) {
      await sendTelegramMessage(message);
    }
  } catch (error) {
    // Allow another webhook attempt to retry delivery.
    processedMessages.delete(messageKey);

    console.error(
      "[TELEGRAM] Delivery error:",
      error.message
    );

    return res.status(502).json({
      ok: false,
      error: "Telegram delivery failed"
    });
  }

  // --------------------------------------------------
  // 12. Success
  // --------------------------------------------------

  console.log(
    "[WEBHOOK] Telegram delivery successful:",
    JSON.stringify({
      uid: uid || null,
      messageId: messageId || null,
      bodyLength: body.length,
      attachmentCount: attachments.length,
      telegramParts: telegramMessages.length
    })
  );

  return res.status(200).json({
    ok: true,
    message: "Client email alert sent",
    uid: uid || null,
    messageId: messageId || null,
    bodyLength: body.length,
    attachmentCount: attachments.length
  });
};
